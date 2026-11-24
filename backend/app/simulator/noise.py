"""Noise building blocks: correlation matrix, AR(1) filters and EMA smoothing.

Why this matters: real sensor noise is not independent white noise. It is
  * correlated between sensors (vibration X and Y move together), and
  * autocorrelated in time (a temperature reading that is high now is probably
    still a bit high one second later).
We get both by drawing correlated Gaussian shocks (Cholesky of a correlation
matrix) and passing each channel through an AR(1) filter.
"""
from __future__ import annotations

import numpy as np
from scipy.signal import lfilter

# Pairwise noise correlations between sensors (engineering judgement, symmetric).
CORRELATIONS: list[tuple[str, str, float]] = [
    ("vib_x_mm_s", "vib_y_mm_s", 0.60),
    ("vib_y_mm_s", "vib_z_mm_s", 0.45),
    ("vib_x_mm_s", "vib_z_mm_s", 0.35),
    ("motor_current_a", "vib_x_mm_s", 0.45),
    ("motor_current_a", "vib_y_mm_s", 0.35),
    ("motor_current_a", "line_speed_bpm", 0.40),
    ("motor_current_a", "film_tension_n", 0.30),
    ("film_tension_n", "line_speed_bpm", 0.35),
    ("sealing_temp_c", "sealing_pressure_bar", 0.30),
    ("forming_temp_c", "sealing_temp_c", 0.25),
    ("cooling_flow_lpm", "sealing_temp_c", -0.20),
    ("cutting_force_n", "vib_z_mm_s", 0.40),
    ("cutting_force_n", "motor_current_a", 0.25),
    ("humidity_pct", "vacuum_kpa", 0.20),
    ("humidity_pct", "cutting_force_n", -0.15),
]


def nearest_correlation(R: np.ndarray, eps: float = 1e-6) -> np.ndarray:
    """Make R a valid (positive-definite) correlation matrix by clipping eigenvalues."""
    R = (R + R.T) / 2.0
    vals, vecs = np.linalg.eigh(R)
    vals = np.clip(vals, eps, None)
    R = vecs @ np.diag(vals) @ vecs.T
    d = np.sqrt(np.diag(R))
    R = R / np.outer(d, d)
    np.fill_diagonal(R, 1.0)
    return R


def build_correlation_matrix(keys: list[str]) -> np.ndarray:
    idx = {k: i for i, k in enumerate(keys)}
    R = np.eye(len(keys))
    for a, b, r in CORRELATIONS:
        if a in idx and b in idx:
            R[idx[a], idx[b]] = R[idx[b], idx[a]] = r
    return nearest_correlation(R)


def cholesky_factor(R: np.ndarray) -> np.ndarray:
    return np.linalg.cholesky(R)


def ar1_filter(shocks: np.ndarray, phi: float, sd: float, zi: float) -> tuple[np.ndarray, float]:
    """y[t] = phi*y[t-1] + sd*sqrt(1-phi^2)*shock[t].

    `zi` is the filter memory carried between chunks (= phi * last y), so a stream
    generated in many small chunks is identical to one big batch.
    Stationary standard deviation of y is exactly `sd`.
    """
    b0 = sd * np.sqrt(max(1.0 - phi * phi, 0.0))
    y, zf = lfilter([b0], [1.0, -phi], shocks, zi=[zi])
    return y, float(zf[0])


def first_order_lag(target: np.ndarray, a: float, zi: float) -> tuple[np.ndarray, float]:
    """Thermal inertia: y[t] = a*y[t-1] + (1-a)*target[t], with a = exp(-dt/tau)."""
    y, zf = lfilter([1.0 - a], [1.0, -a], target, zi=[zi])
    return y, float(zf[0])


def smoothstep(x: np.ndarray) -> np.ndarray:
    """S-shaped 0->1 curve used for motor ramp-up/ramp-down (no infinite jerk)."""
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)
