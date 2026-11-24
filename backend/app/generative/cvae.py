"""Conditional VAE: sensors | condition, with a conditional-mean network plus a residual VAE.

x = mu + g * mean(c)  +  s * dec(z, c)
  * mean(c)    : MLP trained with MSE (what the sensors do on average for this condition)
  * dec(z, c)  : decoder of a VAE trained on the residual, measured in noise units; it learns the
                 noise level, cross-sensor correlation and the extra noise that faults add.
At generation time z follows an AR(1) process (phi=0.9, unit variance) so the output is
temporally correlated like the physics noise instead of white.
"""
from __future__ import annotations

import numpy as np
import torch
from scipy.signal import lfilter
from torch import nn

from .base import N_C, N_X, GenBase, Scaler, SeedSet, mlp, set_threads, train_mean_net


class _Net(nn.Module):
    def __init__(self, latent: int, hidden: int):
        super().__init__()
        self.latent = latent
        self.mean = mlp(N_C, hidden, N_X, depth=3)
        self.enc = mlp(N_X + N_C, hidden, 2 * latent)
        self.dec = mlp(latent + N_C, hidden, N_X)


class CVAEModel(GenBase):
    kind = "cvae"

    def __init__(self, net: _Net, scaler: Scaler, hp: dict):
        self.net, self.scaler, self.hp = net.eval(), scaler, hp
        self.mean_net = net.mean

    def sample(self, C: np.ndarray, seed: int = 0, phi: float = 0.9) -> np.ndarray:
        n, lat = len(C), self.net.latent
        eps = np.random.default_rng(seed).standard_normal((n, lat))
        eps[0] /= np.sqrt(1 - phi**2)                       # stationary start
        z = lfilter([np.sqrt(1 - phi**2)], [1.0, -phi], eps, axis=0)
        out = np.empty((n, N_X))
        sc = self.scaler
        with torch.no_grad():
            for a in range(0, n, 65536):
                c = torch.as_tensor(C[a:a + 65536], dtype=torch.float32)
                zz = torch.as_tensor(z[a:a + 65536], dtype=torch.float32)
                m = self.net.mean(c).numpy().astype(np.float64)
                r = self.net.dec(torch.cat([zz, c], 1)).numpy().astype(np.float64)
                out[a:a + 65536] = sc.mu + sc.g * m + sc.s * r
        return out

    def to_payload(self) -> dict:
        return {"kind": self.kind, "hp": self.hp, "scaler": self.scaler.to_dict(), "state": self.net.state_dict()}

    @classmethod
    def from_payload(cls, p: dict) -> "CVAEModel":
        net = _Net(p["hp"]["latent_dim"], p["hp"]["hidden"])
        net.load_state_dict(p["state"])
        return cls(net, Scaler.from_dict(p["scaler"]), p["hp"])


def train_cvae(seed_set: SeedSet, epochs: int = 60, latent_dim: int = 8, hidden: int = 128, beta: float = 1.0,
               sigma_rec: float = 0.35, seed: int = 0, lr: float = 2e-3, batch: int = 512,
               progress=None) -> tuple[CVAEModel, dict]:
    """progress(epoch, epochs, info) is called once per epoch; it may raise to cancel."""
    set_threads()
    torch.manual_seed(seed)
    sc = Scaler.fit(seed_set.X)
    Xs = torch.as_tensor((seed_set.X - sc.mu) / sc.g, dtype=torch.float32)
    C = torch.as_tensor(seed_set.C, dtype=torch.float32)
    gs = torch.as_tensor(sc.g / sc.s, dtype=torch.float32)            # standardised -> noise units
    n = len(Xs)
    perm = torch.randperm(n)
    n_val = max(1, n // 20)
    val_idx, tr_idx = perm[:n_val], perm[n_val:]

    net = _Net(latent_dim, hidden)
    opt = torch.optim.Adam(net.parameters(), lr=lr)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=max(1, epochs), eta_min=lr * 0.05)
    warm = max(2, int(0.2 * epochs))                                   # mean network only
    anneal = max(2, int(0.3 * epochs))                                 # KL weight ramps 0 -> beta
    hist = {"train": [], "val": [], "kl": []}

    def losses(idx: torch.Tensor, beta_e: float, train: bool):
        x, c = Xs[idx], C[idx]
        m = net.mean(c)
        l_mean = ((m - x) ** 2).mean()
        r = ((x - m.detach()) * gs).clamp(-15, 15)                     # residual in noise units
        mu_z, lv = net.enc(torch.cat([r / 4.0, c], 1)).chunk(2, 1)
        z = mu_z + torch.exp(0.5 * lv) * torch.randn_like(mu_z) if train else mu_z
        rec = (((r - net.dec(torch.cat([z, c], 1))) ** 2).sum(1) / (2 * sigma_rec**2)).mean()
        kl = (-0.5 * (1 + lv - mu_z**2 - lv.exp()).sum(1)).mean()
        return l_mean, rec, kl, l_mean * 10 + rec / N_X + beta_e * kl / N_X

    for ep in range(epochs):
        beta_e = 0.0 if ep < warm else beta * min(1.0, (ep - warm + 1) / anneal)
        net.train()
        order = tr_idx[torch.randperm(len(tr_idx))]
        for k in range(0, len(order), batch):
            idx = order[k:k + batch]
            if ep < warm:
                loss = ((net.mean(C[idx]) - Xs[idx]) ** 2).mean()
            else:
                loss = losses(idx, beta_e, True)[3]
            opt.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(net.parameters(), 5.0)
            opt.step()
        sched.step()
        net.eval()
        with torch.no_grad():
            _, rec, kl, tot = losses(val_idx, beta_e, False)
        hist["train"].append(float(loss.detach())); hist["val"].append(float(tot)); hist["kl"].append(float(kl))
        if progress:
            progress(ep + 1, epochs, {"loss": float(loss.detach()), "val_loss": float(tot), "kl": float(kl), "beta": beta_e})

    hp = {"latent_dim": latent_dim, "hidden": hidden, "beta": beta, "sigma_rec": sigma_rec, "epochs": epochs}
    return CVAEModel(net, sc, hp), hist
