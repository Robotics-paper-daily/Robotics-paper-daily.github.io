"""Centralized configuration for the daily-arxiv pipeline.

All knobs that influence what counts as a "relevant" paper live here, so
adjusting the funnel never requires touching multiple files.

The pipeline operates in two stages:
  1. Stage 1 (keyword prefilter, no LLM): score each paper against four
     keyword tiers + arXiv category bonuses. Papers scoring at least
     ``STAGE1_PASS_THRESHOLD`` proceed; Tier-3 hits force a hard reject
     regardless of other signal.
  2. Stage 2 (LLM rating): only papers passing Stage 1 are sent to the
     LLM for fine-grained scoring (relevance / novelty / clarity /
     impact / overall) plus topic classification and tldr.

Four research interests anchor everything: VLA, World (Action) Models,
Autonomous Driving, and Embodied Intelligence.
"""

# ============================================================================
# Stage 1 — keyword tiers
# ============================================================================
# Multi-word phrases (KEYWORDS lists) are matched after normalizing whitespace
# and hyphens; short tokens (TOKENS lists) get explicit \b...\b boundaries to
# avoid substring collisions like "slam" matching "Islam".

# Tier 0 — direct hits on the four core lines. Single hit is a strong signal.
TIER0_KEYWORDS: tuple[str, ...] = (
    # ---- Vision-Language-Action ----
    "vision-language-action",
    "vision language action",
    "vla model",
    "vla policy",
    "vla pretraining",
    "generalist policy",
    "robot foundation model",
    "foundation policy",
    # ---- World models (incl. Dreamer-style latent dynamics variants) ----
    "world model",
    "world action model",
    "action world model",
    "video world model",
    "neural world model",
    "generative world model",
    "predictive world model",
    "latent dynamics model",
    "latent dynamic model",
    "latent world model",
    # ---- Vision-Language-Navigation ----
    "vision-language-navigation",
    "vision language navigation",
    # ---- Embodied intelligence ----
    "embodied ai",
    "embodied agent",
    "embodied intelligence",
    "embodied learning",
    "humanoid robot",
    "legged robot",
    # ---- Robotics core ----
    "dexterous manipulation",
    "mobile manipulation",
    "bimanual manipulation",
    "whole-body control",
    "whole body control",
    "sim-to-real",
    "sim2real",
    # ---- Autonomous driving ----
    "autonomous driving",
    "end-to-end driving",
    "end to end driving",
    "self-driving",
    "driving foundation model",
    "driving world model",
    "closed-loop driving",
    "closed loop driving",
)

TIER0_TOKENS: tuple[str, ...] = (
    "vla",
    "vln",
)

# Tier 1 — strong support words that frequently co-occur with Tier 0.
# Generic "VLM"/"vision-language model" is intentionally NOT here — it's a
# tool, not a research target. Those mentions live in Tier 2 so a pure VLM
# paper cannot pass on VLM mentions alone; it must also touch robots /
# driving / embodied (Tier 0/1) to clear the threshold.
TIER1_KEYWORDS: tuple[str, ...] = (
    # Robotics — list both "robotic X" and "robot X" to catch variants.
    "robotic manipulation",
    "robot manipulation",
    "robotic grasping",
    "robot grasping",
    "grasp planning",
    "robotic navigation",
    "robot navigation",
    "robot learning",
    "robot policy",
    "locomotion",
    "quadruped",
    "bipedal",
    "teleoperation",
    "proprioception",
    "proprioceptive",
    "imitation learning",
    "diffusion policy",
    "behavior cloning",
    "foundation model for robotics",
    "model-based reinforcement learning",
    "model based reinforcement learning",
    "model-based rl",
    # Driving
    "bev perception",
    "occupancy prediction",
    "occupancy network",
    "trajectory prediction",
    "scenario generation",
    "nuscenes",
    "waymo",
    "carla",
    "navsim",
    "driving with llm",
    "driving with vlm",
)

TIER1_TOKENS: tuple[str, ...] = ()

# Tier 2 — weak context. Useful only when paired with higher-tier hits.
# Includes generic VLM/LLM mentions so they can boost a robotics-related
# paper but cannot single-handedly push something past the threshold.
TIER2_KEYWORDS: tuple[str, ...] = (
    "reinforcement learning",
    "policy learning",
    "policy optimization",
    "motion planning",
    "trajectory optimization",
    "task planning",
    "skill learning",
    "mapping",
    "localization",
    "3d perception",
    "3d scene",
    "multimodal llm",
    "vision-language model",
    "vision language model",
)

TIER2_TOKENS: tuple[str, ...] = (
    "slam",
    "vlm",
)

# Tier 3 — hard exclusions. Hitting any of these forces rejection.
# Note: autonomous driving was previously here and has been removed — driving
# work is now in scope (Tier 0).
TIER3_KEYWORDS: tuple[str, ...] = (
    "medical imaging",
    "radiology",
    "pathology",
    "histology",
    "protein structure",
    "drug discovery",
    "molecular design",
    "single-cell",
    "dna sequencing",
    "speech recognition",
    "text-to-speech",
    "machine translation",
    "sentiment analysis",
    "recommendation system",
    "collaborative filtering",
    "stock prediction",
    "ctr prediction",
    "click-through rate",
)

TIER3_TOKENS: tuple[str, ...] = (
    "asr",
    "tts",
    "genomics",
)


# ============================================================================
# Stage 1 — scoring weights
# ============================================================================

TIER0_WEIGHT: int = 5
TIER1_WEIGHT: int = 2
TIER2_WEIGHT: int = 1
TIER3_WEIGHT: int = -20

# Per-tier caps prevent any single tier from saturating the score on its own.
TIER0_CAP: int = 12
TIER1_CAP: int = 6
TIER2_CAP: int = 3

# Hits in the title count more than hits in the abstract.
TITLE_MULTIPLIER: float = 2.0

# Bonus for the paper's arXiv categories.
CATEGORY_BONUS: dict[str, int] = {
    "cs.ro": 5,
    "cs.ai": 1,
}

# Minimum total Stage-1 score to advance to LLM rating.
# Calibration: a single Tier-0 abstract hit (=5) passes; a single Tier-0
# title hit (=10) passes; cs.RO category alone (=5) passes (then LLM filters).
STAGE1_PASS_THRESHOLD: int = 5


# ============================================================================
# Stage 2 — topic enumeration
# ============================================================================
# The LLM picks one bucket per paper. Anything outside this set is coerced to
# "Other" downstream so the front-end never has to handle unknown values.

TOPICS: tuple[str, ...] = (
    "VLA",
    "WorldModel",
    "AutonomousDriving",
    "VLN",
    "Manipulation",
    "Locomotion",
    "HumanoidEmbodied",
    "RLRobot",
    "Perception3D",
    "Other",
)


# ============================================================================
# Display + cost thresholds
# ============================================================================

# In each daily HTML report, papers with overall_priority_score >= this go in
# the headline section; the rest fall into the lower "low-score" section.
SCORE_THRESHOLD: float = 6.0

# Only translate the full English abstract to Chinese for papers above this
# score, to keep API cost bounded.
TRANSLATION_MIN_SCORE: float = 6.0
