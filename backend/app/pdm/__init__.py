"""Phase 4: fidelity metrics and predictive-maintenance models (fault classification, RUL)."""
from .features import window_features
from .models import PdmBundle, evaluate, predict_run, train
from .quality import compare_runs

__all__ = ["window_features", "PdmBundle", "train", "evaluate", "predict_run", "compare_runs"]
