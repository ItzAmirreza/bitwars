//! Server-matching validation constants.
//!
//! Movement.rs already enforces world bounds and speed clamping internally,
//! matching the client. These constants are kept for reference and potential
//! future use by the environment if needed.

/// Max horizontal movement speed before the server flags a violation.
pub const MAX_MOVEMENT_SPEED: f32 = 35.0;
/// Max block destroy range from player position.
pub const MAX_BLOCK_DESTROY_RANGE: f32 = 40.0;
/// Fire rate tolerance in seconds (150000 microseconds).
pub const FIRE_RATE_TOLERANCE_SECS: f32 = 0.15;
