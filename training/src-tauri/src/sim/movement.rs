//! Player movement physics — 1:1 port of client/src/game/FPSControls.ts
//!
//! Every constant, formula, and edge case matches the client exactly.
//! No visual-only effects (head bob, camera tilt, FOV offset, landing dip)
//! are included since they don't affect physics.

use super::collision::{
    can_stand_up, check_ceiling, get_ground_level, is_against_wall, move_with_collision,
    WALL_CLIMB_SPEED,
};
use super::world::EnvTerrain;

/// Bot action input for a single step.
#[derive(Clone, Debug, Default)]
pub struct MoveAction {
    /// Movement direction relative to look direction (-1 to 1)
    pub forward: f32,
    pub strafe: f32,
    /// Look direction in radians (yaw, pitch)
    pub yaw: f32,
    pub pitch: f32,
    /// Discrete actions
    pub jump: bool,
    pub sprint: bool,
    pub crouch: bool,
}

/// Complete player movement state.
#[derive(Clone, Debug)]
pub struct PlayerMovement {
    // Position (camera/eye position, matching client's camera.position)
    pub pos_x: f32,
    pub pos_y: f32, // eye Y
    pub pos_z: f32,

    // Look direction
    pub yaw: f32,
    pub pitch: f32,

    // Horizontal velocity (separate from vertical, matching client)
    pub h_vel_x: f32,
    pub h_vel_z: f32,

    // Vertical velocity
    pub vel_y: f32,

    // State flags
    pub on_ground: bool,
    pub is_jumping: bool,
    pub is_sprinting: bool,
    pub is_crouching: bool,
    pub is_sliding: bool,
    pub is_climbing: bool,

    // Eye height interpolation
    pub current_eye_height: f32,
    target_eye_height: f32,

    // Coyote time
    coyote_timer: f32,

    // Jump buffer
    jump_buffered: bool,
    jump_buffer_timer: f32,

    // Slide state
    slide_timer: f32,
    slide_speed: f32,
    slide_dir_x: f32,
    slide_dir_z: f32,

    // Speed multiplier (for buffs)
    pub speed_multiplier: f32,

    // Horizontal speed cache
    pub horizontal_speed: f32,

    // Health
    pub health: f32,
    pub max_health: f32,
}

// Constants — matching client FPSControls exactly
const SPEED: f32 = 12.0;
const SPRINT_SPEED: f32 = 18.0;
const CROUCH_SPEED: f32 = 5.0;
const JUMP_FORCE: f32 = 9.5;
const GRAVITY: f32 = -40.0;
const GRAVITY_ASCENDING: f32 = -22.0;
const TERMINAL_VELOCITY: f32 = -35.0;
const GROUND_ACCEL: f32 = 65.0;
const GROUND_FRICTION: f32 = 45.0;
const AIR_ACCEL: f32 = 18.0;
const STAND_HEIGHT: f32 = 1.7;
const CROUCH_HEIGHT: f32 = 1.0;
const COYOTE_TIME: f32 = 0.1;
const JUMP_BUFFER_TIME: f32 = 0.1;
const SLIDE_DURATION: f32 = 0.75;
const SLIDE_MIN_SPEED: f32 = 10.0;
const SLIDE_INITIAL_SPEED: f32 = 22.0;

// World bounds matching client
const MIN_BOUND: f32 = 0.5;
const MAX_X: f32 = 749.5; // worldSizeX - 0.5
const MAX_Z: f32 = 749.5; // worldSizeZ - 0.5
const MIN_Y: f32 = -5.0;
const MAX_Y: f32 = 95.0;

// Over-speed reduction rates matching client
const GROUND_REDUCTION_RATE: f32 = 15.0;
const AIR_REDUCTION_RATE: f32 = 5.0;

impl PlayerMovement {
    pub fn new(x: f32, y: f32, z: f32) -> Self {
        PlayerMovement {
            pos_x: x,
            pos_y: y,
            pos_z: z,
            yaw: 0.0,
            pitch: 0.0,
            h_vel_x: 0.0,
            h_vel_z: 0.0,
            vel_y: 0.0,
            on_ground: false,
            is_jumping: false,
            is_sprinting: false,
            is_crouching: false,
            is_sliding: false,
            is_climbing: false,
            current_eye_height: STAND_HEIGHT,
            target_eye_height: STAND_HEIGHT,
            coyote_timer: 0.0,
            jump_buffered: false,
            jump_buffer_timer: 0.0,
            slide_timer: 0.0,
            slide_speed: 0.0,
            slide_dir_x: 0.0,
            slide_dir_z: 0.0,
            speed_multiplier: 1.0,
            horizontal_speed: 0.0,
            health: 150.0,
            max_health: 150.0,
        }
    }

    /// Reset all state for a new episode.
    pub fn reset(&mut self, x: f32, y: f32, z: f32) {
        self.pos_x = x;
        self.pos_y = y;
        self.pos_z = z;
        self.yaw = 0.0;
        self.pitch = 0.0;
        self.h_vel_x = 0.0;
        self.h_vel_z = 0.0;
        self.vel_y = 0.0;
        self.on_ground = false;
        self.is_jumping = false;
        self.is_sprinting = false;
        self.is_crouching = false;
        self.is_sliding = false;
        self.is_climbing = false;
        self.current_eye_height = STAND_HEIGHT;
        self.target_eye_height = STAND_HEIGHT;
        self.coyote_timer = 0.0;
        self.jump_buffered = false;
        self.jump_buffer_timer = 0.0;
        self.slide_timer = 0.0;
        self.slide_speed = 0.0;
        self.slide_dir_x = 0.0;
        self.slide_dir_z = 0.0;
        self.speed_multiplier = 1.0;
        self.horizontal_speed = 0.0;
        self.health = self.max_health;
    }

    /// Apply external impulse (e.g. explosion knockback).
    /// Matches client's FPSControls.applyImpulse().
    pub fn apply_impulse(&mut self, x: f32, y: f32, z: f32) {
        self.h_vel_x += x;
        self.vel_y += y;
        self.h_vel_z += z;
        if y > 0.0 {
            self.on_ground = false;
            self.is_jumping = true;
            self.coyote_timer = 0.0;
        }
    }

    /// Get velocity vector matching client's getVelocity().
    pub fn get_velocity(&self) -> (f32, f32, f32) {
        (self.h_vel_x, self.vel_y, self.h_vel_z)
    }

    /// Get foot Y position.
    pub fn foot_y(&self) -> f32 {
        self.pos_y - self.current_eye_height
    }

    /// Get current player height (stand or crouch).
    pub fn player_height(&self) -> f32 {
        if self.is_crouching {
            CROUCH_HEIGHT
        } else {
            STAND_HEIGHT
        }
    }

    fn execute_jump(&mut self) {
        self.vel_y = JUMP_FORCE;
        self.on_ground = false;
        self.is_jumping = true;
        self.coyote_timer = 0.0;
        self.jump_buffered = false;
        self.jump_buffer_timer = 0.0;
        // End slide but preserve momentum
        if self.is_sliding {
            self.is_sliding = false;
        }
    }

    /// Main update — matches client's FPSControls.update() exactly.
    /// delta is in seconds.
    pub fn update(&mut self, delta: f32, action: &MoveAction, world: &EnvTerrain) {
        let _prev_vel_y = self.vel_y;

        // Apply look direction
        self.yaw = action.yaw;
        self.pitch = action.pitch.clamp(-std::f32::consts::FRAC_PI_2, std::f32::consts::FRAC_PI_2);

        // Sprint state (persists through jumps like Minecraft)
        self.is_sprinting =
            action.sprint && action.forward > 0.0 && !self.is_crouching && !self.is_sliding;

        // Crouch with headroom check
        if action.crouch {
            // Slide activation: on ground, moving fast, not already sliding
            if self.on_ground
                && !self.is_sliding
                && !self.is_crouching
                && self.horizontal_speed >= SLIDE_MIN_SPEED
            {
                self.is_sliding = true;
                self.slide_timer = SLIDE_DURATION;
                self.slide_speed = self.horizontal_speed.max(SLIDE_INITIAL_SPEED);
                let len = (self.h_vel_x * self.h_vel_x + self.h_vel_z * self.h_vel_z).sqrt();
                if len > 0.1 {
                    self.slide_dir_x = self.h_vel_x / len;
                    self.slide_dir_z = self.h_vel_z / len;
                }
            }
            self.is_crouching = true;
        } else if self.is_crouching {
            if can_stand_up(
                world,
                self.pos_x,
                self.pos_z,
                self.foot_y(),
                STAND_HEIGHT,
            ) {
                self.is_crouching = false;
            }
        }

        // Target speed
        let mut target_speed = SPEED;
        if self.is_sprinting {
            target_speed = SPRINT_SPEED;
        } else if self.is_crouching && !self.is_sliding {
            target_speed = CROUCH_SPEED;
        }
        target_speed *= self.speed_multiplier;

        // Eye height interpolation — matches client's exponential lerp
        self.target_eye_height = if self.is_crouching {
            CROUCH_HEIGHT
        } else {
            STAND_HEIGHT
        };
        let height_lerp = 1.0 - (0.00001f32).powf(delta);
        self.current_eye_height +=
            (self.target_eye_height - self.current_eye_height) * height_lerp;

        // Slide update
        if self.is_sliding {
            self.slide_timer -= delta;
            let slide_progress = 1.0 - (self.slide_timer / SLIDE_DURATION);
            let slide_decay = 1.0 - slide_progress * slide_progress; // quadratic ease-out
            let current_slide_speed = self.slide_speed * slide_decay;

            // Override horizontal velocity with slide direction
            self.h_vel_x = self.slide_dir_x * current_slide_speed;
            self.h_vel_z = self.slide_dir_z * current_slide_speed;

            // End conditions
            if self.slide_timer <= 0.0 || !action.crouch {
                self.is_sliding = false;
            }

            // Prevent speed clamping from killing the slide
            target_speed = target_speed.max(current_slide_speed);
        }

        // Input direction (skip during slide)
        if !self.is_sliding {
            let dir_x = action.strafe;
            let dir_z = -action.forward;
            let dir_len = (dir_x * dir_x + dir_z * dir_z).sqrt();

            // World-space movement vectors from yaw
            let cos_yaw = self.yaw.cos();
            let sin_yaw = self.yaw.sin();
            // forward = (sin_yaw, 0, -cos_yaw) matching THREE.js quaternion (0,0,-1)
            // right = (cos_yaw, 0, sin_yaw) matching THREE.js quaternion (1,0,0)
            // But client does: forward = (0,0,-1).applyQuaternion, then forward.y=0, normalize
            // For pure yaw rotation: forward = (-sin_yaw, 0, -cos_yaw), right = (cos_yaw, 0, -sin_yaw)
            // Actually let me match precisely:
            // THREE.js with YXZ euler order, yaw = euler.y:
            // (0,0,-1) rotated by yaw around Y = (-sin(yaw), 0, -cos(yaw))
            // (1,0,0) rotated by yaw around Y = (cos(yaw), 0, -sin(yaw))
            let fwd_x = -sin_yaw;
            let fwd_z = -cos_yaw;
            let right_x = cos_yaw;
            let right_z = -sin_yaw;

            let has_input = dir_len > 0.001;

            if has_input {
                let norm_dir_x = dir_x / dir_len;
                let norm_dir_z = dir_z / dir_len;

                // wishDir in world space: forward * (-dir_z) + right * dir_x
                // Client does: wishDir.addScaledVector(forward, -direction.z)
                //              wishDir.addScaledVector(right, direction.x)
                let wish_x = fwd_x * (-norm_dir_z) + right_x * norm_dir_x;
                let wish_z = fwd_z * (-norm_dir_z) + right_z * norm_dir_x;
                let wish_len = (wish_x * wish_x + wish_z * wish_z).sqrt();

                if wish_len > 0.001 {
                    let wish_nx = wish_x / wish_len;
                    let wish_nz = wish_z / wish_len;

                    let accel = if self.on_ground {
                        GROUND_ACCEL
                    } else {
                        AIR_ACCEL
                    };

                    let wish_speed_x = wish_nx * target_speed;
                    let wish_speed_z = wish_nz * target_speed;
                    let diff_x = wish_speed_x - self.h_vel_x;
                    let diff_z = wish_speed_z - self.h_vel_z;
                    let accel_amount = accel * delta;
                    let diff_len = (diff_x * diff_x + diff_z * diff_z).sqrt();
                    if diff_len > 0.0 {
                        let applied_accel = accel_amount.min(diff_len);
                        self.h_vel_x += (diff_x / diff_len) * applied_accel;
                        self.h_vel_z += (diff_z / diff_len) * applied_accel;
                    }
                }
            } else if self.on_ground {
                // Ground friction when no input
                let cur_speed =
                    (self.h_vel_x * self.h_vel_x + self.h_vel_z * self.h_vel_z).sqrt();
                if cur_speed > 0.1 {
                    let drop = GROUND_FRICTION * delta;
                    let factor = (cur_speed - drop).max(0.0) / cur_speed;
                    self.h_vel_x *= factor;
                    self.h_vel_z *= factor;
                } else {
                    self.h_vel_x = 0.0;
                    self.h_vel_z = 0.0;
                }
            }
            // Note: air friction = 2.0 in client but only applied via the accel system,
            // not as explicit friction. No explicit air friction when no input — matches client.
        }

        // Soft speed clamping (gradual deceleration instead of hard cap)
        self.horizontal_speed =
            (self.h_vel_x * self.h_vel_x + self.h_vel_z * self.h_vel_z).sqrt();
        let max_speed = if self.is_sliding {
            self.slide_speed
        } else {
            target_speed * 1.1
        };
        if self.horizontal_speed > max_speed {
            let over_speed = self.horizontal_speed - max_speed;
            let reduction_rate = if self.on_ground {
                GROUND_REDUCTION_RATE
            } else {
                AIR_REDUCTION_RATE
            };
            let reduction = over_speed.min(reduction_rate * delta);
            let scale = (self.horizontal_speed - reduction) / self.horizontal_speed;
            self.h_vel_x *= scale;
            self.h_vel_z *= scale;
            self.horizontal_speed =
                (self.h_vel_x * self.h_vel_x + self.h_vel_z * self.h_vel_z).sqrt();
        }

        // Apply horizontal velocity with collision detection
        {
            let foot_y = self.foot_y();
            let player_height = self.player_height();
            let result = move_with_collision(
                world,
                self.pos_x,
                self.pos_z,
                self.h_vel_x * delta,
                self.h_vel_z * delta,
                foot_y,
                player_height,
            );
            self.pos_x = result.new_x;
            self.pos_z = result.new_z;
            if result.collided_x {
                self.h_vel_x = 0.0;
            }
            if result.collided_z {
                self.h_vel_z = 0.0;
            }
        }

        // Variable gravity + terminal velocity
        let grav = if self.vel_y > 0.0 {
            GRAVITY_ASCENDING
        } else {
            GRAVITY
        };
        self.vel_y += grav * delta;
        if self.vel_y < TERMINAL_VELOCITY {
            self.vel_y = TERMINAL_VELOCITY;
        }
        self.pos_y += self.vel_y * delta;

        // Ceiling collision
        {
            let foot_y = self.foot_y();
            let player_height = self.player_height();
            if let Some((camera_y, new_vel_y)) = check_ceiling(
                world,
                self.pos_x,
                self.pos_z,
                self.vel_y,
                foot_y,
                player_height,
                self.current_eye_height,
            ) {
                self.pos_y = camera_y;
                self.vel_y = new_vel_y;
            }
        }

        // Wall climbing: hold space while airborne and against a wall
        if !self.on_ground
            && action.jump
            && is_against_wall(world, self.pos_x, self.pos_z, self.foot_y(), self.player_height())
        {
            self.is_climbing = true;
            self.vel_y = WALL_CLIMB_SPEED;
            // Wall friction on horizontal movement
            self.h_vel_x *= 0.9;
            self.h_vel_z *= 0.9;
        } else {
            self.is_climbing = false;
        }

        // Mantle: when climbing and head clears the wall top, boost onto the ledge
        if self.is_climbing {
            let foot_y = self.foot_y();
            let player_height = self.player_height();
            let head_block_y = (foot_y + player_height).floor() as i32;
            let foot_block_y = foot_y.floor() as i32;

            let head_clear = world.get_block(
                self.pos_x.floor() as i32,
                head_block_y,
                self.pos_z.floor() as i32,
            ) == 0;
            let feet_at_block = world.get_block(
                self.pos_x.floor() as i32,
                foot_block_y,
                self.pos_z.floor() as i32,
            ) != 0;

            if head_clear && feet_at_block {
                self.pos_y = foot_block_y as f32 + 1.0 + self.current_eye_height;
                self.vel_y = 1.0;
                self.is_climbing = false;
                self.on_ground = true;
            }
        }

        // Coyote time
        if self.on_ground {
            self.coyote_timer = COYOTE_TIME;
        } else {
            self.coyote_timer = (self.coyote_timer - delta).max(0.0);
        }

        // Jump buffer countdown
        if self.jump_buffered {
            self.jump_buffer_timer -= delta;
            if self.jump_buffer_timer <= 0.0 {
                self.jump_buffered = false;
            }
        }

        // Handle jump input
        if action.jump && !self.is_climbing {
            if self.on_ground || self.coyote_timer > 0.0 || self.is_sliding {
                self.execute_jump();
            } else if !self.jump_buffered {
                self.jump_buffered = true;
                self.jump_buffer_timer = JUMP_BUFFER_TIME;
            }
        }

        // Ground collision
        let ground_height =
            get_ground_level(world, self.pos_x, self.pos_z, self.foot_y()) + self.current_eye_height;
        let was_on_ground = self.on_ground;

        if self.pos_y < ground_height {
            self.pos_y = ground_height;
            // No landing dip in sim (visual only in client)
            self.vel_y = 0.0;
            self.on_ground = true;
            self.is_jumping = false;

            // Auto-jump if space held or jump buffered (Minecraft style)
            if action.jump || self.jump_buffered {
                self.execute_jump();
            }
        } else if self.pos_y > ground_height + 0.2 {
            self.on_ground = false;
            if was_on_ground && !self.is_jumping {
                self.coyote_timer = COYOTE_TIME;
            }
            // End slide if we fall off an edge
            if self.is_sliding {
                self.is_sliding = false;
            }
        }

        // World bounds
        self.pos_x = self.pos_x.clamp(MIN_BOUND, MAX_X);
        self.pos_y = self.pos_y.clamp(MIN_Y, MAX_Y);
        self.pos_z = self.pos_z.clamp(MIN_BOUND, MAX_Z);
    }
}
