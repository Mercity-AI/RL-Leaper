"""Explicit, serializable optimizer schedules shared by MLP and recurrent PPO."""
from dataclasses import dataclass


@dataclass(frozen=True)
class LinearLearningRate:
    initial: float = .00015
    final: float = .000015

    def __post_init__(self):
        if not 0 < self.final <= self.initial:
            raise ValueError('Require 0 < final <= initial')

    def __call__(self, progress_remaining):
        progress=max(0.,min(1.,float(progress_remaining)))
        return self.final+(self.initial-self.final)*progress

    def config(self):
        return dict(kind='linear',initial=self.initial,final=self.final,
            clock='fraction of declared total environment-transition budget remaining',
            formula='final + (initial - final) * clip(progress_remaining, 0, 1)',
            extension='Do not silently reset upward; choose and record an explicit extension schedule.')
