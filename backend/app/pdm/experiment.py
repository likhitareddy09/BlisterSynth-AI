"""Train-on-X / test-on-physics experiments (TSTR = train on synthetic, test on real)."""
from __future__ import annotations

from . import models
from .data import make_runs, make_scenarios

TEST_SEED_OFFSET = 10_000


def default_stride(task: str) -> float:
    return 30.0 if task == "fault" else 10.0


def run_experiment(task: str, generator=None, n_train: int = 120, n_test: int = 20, duration_s: int = 1800,
                   window_s: float = 60.0, rul_cap_s: float = 600.0, stride_s: float | None = None,
                   seed: int = 7, test_runs: list[dict] | None = None):
    """Train on runs from `generator` (None = physics), evaluate on physics test runs.
    Returns (bundle, metrics, test_runs) so callers can reuse the test runs."""
    stride = stride_s or default_stride(task)
    train_runs = make_runs(make_scenarios(n_train, duration_s, seed), model=generator)
    if test_runs is None:
        test_runs = make_runs(make_scenarios(n_test, duration_s, seed + TEST_SEED_OFFSET))
    bundle = models.train(task, train_runs, window_s, stride, rul_cap_s, seed)
    return bundle, models.evaluate(bundle, test_runs), test_runs
