"""Conditional TimeGAN (compact): GRU embedder/recovery/generator/supervisor/discriminator.

Like the cVAE it models the *residual* around a conditional-mean network, in noise units
(divided by 4 to keep values near +-1).  Every GRU also receives the per-step condition vector,
so generated windows follow the speed profile and fault severities.  Windows of `window`
samples are generated independently and stitched, so noise is only continuous inside a window.
Training follows TimeGAN: (1) autoencoder, (2) supervisor, (3) joint adversarial training.
"""
from __future__ import annotations

import math

import numpy as np
import torch
import torch.nn.functional as F
from torch import nn

from .base import N_C, N_X, GenBase, Scaler, SeedSet, mlp, set_threads, train_mean_net

RES_SCALE = 4.0


class _Seq(nn.Module):
    def __init__(self, i: int, h: int, o: int, act=None, layers: int = 1):
        super().__init__()
        self.rnn = nn.GRU(i, h, num_layers=layers, batch_first=True)
        self.out = nn.Linear(h, o)
        self.act = act

    def forward(self, x):
        y = self.out(self.rnn(x)[0])
        return self.act(y) if self.act else y


class _GAN(nn.Module):
    def __init__(self, zd: int, h: int):
        super().__init__()
        self.zd = zd
        self.E = _Seq(N_X + N_C, h, h, torch.sigmoid)
        self.R = _Seq(h, h, N_X)
        self.G = _Seq(zd + N_C, h, h, torch.sigmoid)
        self.S = _Seq(h, h, h, torch.sigmoid)
        self.D = _Seq(h + N_C, h, 1)


class TimeGANModel(GenBase):
    kind = "timegan"

    def __init__(self, gan: _GAN, mean_net: nn.Module, scaler: Scaler, hp: dict):
        self.gan, self.mean_net, self.scaler, self.hp = gan.eval(), mean_net.eval(), scaler, hp

    def sample(self, C: np.ndarray, seed: int = 0) -> np.ndarray:
        n, L, zd = len(C), self.hp["window"], self.gan.zd
        nw = math.ceil(n / L)
        pad = nw * L - n
        Cp = np.vstack([C, np.repeat(C[-1:], pad, 0)]) if pad else C
        Cw = torch.as_tensor(Cp.reshape(nw, L, N_C), dtype=torch.float32)
        Z = torch.as_tensor(np.random.default_rng(seed).standard_normal((nw, L, zd)), dtype=torch.float32)
        outs = []
        with torch.no_grad():
            for a in range(0, nw, 512):
                h = self.gan.G(torch.cat([Z[a:a + 512], Cw[a:a + 512]], 2))
                outs.append(self.gan.R(self.gan.S(h)).numpy())
        r = np.concatenate(outs).reshape(nw * L, N_X)[:n].astype(np.float64) * RES_SCALE
        return self.mean_physical(C) + self.scaler.s * r

    def to_payload(self) -> dict:
        return {"kind": self.kind, "hp": self.hp, "scaler": self.scaler.to_dict(),
                "state": self.gan.state_dict(), "mean_state": self.mean_net.state_dict()}

    @classmethod
    def from_payload(cls, p: dict) -> "TimeGANModel":
        hp = p["hp"]
        gan = _GAN(hp["latent_dim"], hp["gru_hidden"])
        gan.load_state_dict(p["state"])
        mean = mlp(N_C, hp["hidden"], N_X, depth=3)
        mean.load_state_dict(p["mean_state"])
        return cls(gan, mean, Scaler.from_dict(p["scaler"]), hp)


def train_timegan(seed_set: SeedSet, epochs: int = 30, latent_dim: int = 8, hidden: int = 128, window: int = 24,
                  seed: int = 0, lr: float = 1e-3, batch: int = 128, progress=None) -> tuple[TimeGANModel, dict]:
    set_threads()
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    sc = Scaler.fit(seed_set.X)
    Xs = torch.as_tensor((seed_set.X - sc.mu) / sc.g, dtype=torch.float32)
    C = torch.as_tensor(seed_set.C, dtype=torch.float32)
    gs = torch.as_tensor(sc.g / sc.s, dtype=torch.float32)

    # phases: mean net, autoencoder, supervisor, joint
    e_mean, e1, e2 = max(2, round(0.2 * epochs)), max(2, round(0.2 * epochs)), max(2, round(0.2 * epochs))
    e3 = max(2, epochs - e_mean - e1 - e2)
    total, done = e_mean + e1 + e2 + e3, 0
    hist: dict[str, list] = {"d_loss": [], "g_loss": []}

    def tick(info: dict):
        nonlocal done
        done += 1
        if progress:
            progress(done, total, info)

    mean_net = mlp(N_C, hidden, N_X, depth=3)
    train_mean_net(mean_net, Xs, C, e_mean, tick=lambda ep, l: tick({"stage": "mean", "loss": l}))
    with torch.no_grad():
        res = ((Xs - mean_net(C)) * gs).clamp(-12, 12) / RES_SCALE

    L = window
    starts = np.concatenate([np.arange(a, b - L + 1, max(1, L // 2)) for a, b in seed_set.bounds if b - a >= L])
    off = np.arange(L)
    Rw = res[torch.as_tensor(starts[:, None] + off)]                 # (nw, L, N_X)
    Cw = C[torch.as_tensor(starts[:, None] + off)]
    nw = len(starts)
    its = max(30, min(60, nw // batch))      # at least 30 steps per epoch, even for small seed sets

    H = max(16, hidden // 4)
    gan = _GAN(latent_dim, H)
    opt_e = torch.optim.Adam([*gan.E.parameters(), *gan.R.parameters()], lr=lr)
    opt_g = torch.optim.Adam([*gan.G.parameters(), *gan.S.parameters()], lr=lr)
    opt_d = torch.optim.Adam(gan.D.parameters(), lr=lr)

    def batch_idx():
        return torch.as_tensor(rng.integers(0, nw, size=min(batch, nw)))

    def embed(x, c):
        h = gan.E(torch.cat([x, c], 2))
        return h, gan.R(h)

    for _ in range(e1):                                              # 1) autoencoder
        for _ in range(its):
            i = batch_idx(); x, c = Rw[i], Cw[i]
            h, xr = embed(x, c)
            loss = 10 * torch.sqrt(F.mse_loss(xr, x))
            opt_e.zero_grad(); loss.backward(); opt_e.step()
        tick({"stage": "autoencoder", "loss": float(loss.detach())})
    for _ in range(e2):                                              # 2) supervisor
        for _ in range(its):
            i = batch_idx(); x, c = Rw[i], Cw[i]
            with torch.no_grad():
                h, _ = embed(x, c)
            loss = F.mse_loss(gan.S(h)[:, :-1], h[:, 1:])
            opt_g.zero_grad(); loss.backward(); opt_g.step()
        tick({"stage": "supervisor", "loss": float(loss.detach())})
    bce = F.binary_cross_entropy_with_logits
    for _ in range(e3):                                              # 3) joint training
        for _ in range(its):
            i = batch_idx(); x, c = Rw[i], Cw[i]
            z = torch.randn(len(i), L, latent_dim)
            # generator + supervisor
            h, _ = embed(x, c)
            h = h.detach()
            hh = gan.G(torch.cat([z, c], 2)); hs = gan.S(hh); xh = gan.R(hs)
            g_u = bce(gan.D(torch.cat([hh, c], 2)), torch.ones(len(i), L, 1)) + \
                bce(gan.D(torch.cat([hs, c], 2)), torch.ones(len(i), L, 1))
            g_s = F.mse_loss(gan.S(h)[:, :-1], h[:, 1:])
            g_v = (xh.std(0, unbiased=False) - x.std(0, unbiased=False)).abs().mean() + \
                (xh.mean(0) - x.mean(0)).abs().mean()
            g_loss = g_u + 100 * torch.sqrt(g_s) + 100 * g_v
            opt_g.zero_grad(); g_loss.backward(); opt_g.step()
            # embedder / recovery
            h2, xr = embed(x, c)
            e_loss = 10 * torch.sqrt(F.mse_loss(xr, x)) + 0.1 * F.mse_loss(gan.S(h2)[:, :-1], h2[:, 1:])
            opt_e.zero_grad(); e_loss.backward(); opt_e.step()
            # discriminator
            with torch.no_grad():
                h3, _ = embed(x, c)
                hh = gan.G(torch.cat([z, c], 2)); hs = gan.S(hh)
            d_loss = bce(gan.D(torch.cat([h3, c], 2)), torch.ones(len(i), L, 1)) + \
                bce(gan.D(torch.cat([hs, c], 2)), torch.zeros(len(i), L, 1)) + \
                bce(gan.D(torch.cat([hh, c], 2)), torch.zeros(len(i), L, 1))
            if float(d_loss.detach()) > 0.15:
                opt_d.zero_grad(); d_loss.backward(); opt_d.step()
        hist["d_loss"].append(float(d_loss.detach())); hist["g_loss"].append(float(g_loss.detach()))
        tick({"stage": "joint", "d_loss": float(d_loss.detach()), "g_loss": float(g_loss.detach())})

    hp = {"latent_dim": latent_dim, "hidden": hidden, "gru_hidden": H, "window": window, "epochs": epochs}
    return TimeGANModel(gan, mean_net, sc, hp), hist
