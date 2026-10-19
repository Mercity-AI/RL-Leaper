// The old name of the game's sound engine, kept so every existing import keeps
// working. The engine itself now lives in src/audio/: AudioService (one
// AudioContext, mix buses, limiter, voice limits, 3D sound, the sound manifest)
// and GameAudio (the fire / play / playSlot / step API the gameplay code uses).
// New code imports GameAudio from src/audio/GameAudio.js.
export { GameAudio as LaserAudio } from '../audio/GameAudio.js';
