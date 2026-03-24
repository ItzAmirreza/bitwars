use crate::tables::vehicle_input_cmd;
use crate::tables::VehicleInputCmd;
use spacetimedb::ReducerContext;

// Allow enough burst tolerance to avoid dropping inputs during transient stalls.
const MAX_INPUT_QUEUE_PER_VEHICLE: usize = 128;

#[derive(Clone)]
pub struct VehicleControls {
    pub forward: f32,
    pub strafe: f32,
    pub lift: f32,
    pub yaw: f32,
    pub boosting: bool,
    pub seq: u32,
}

/// Target queue depth. If the queue exceeds this, we drain extras
/// to prevent a permanent input lag backlog from accumulating.
const TARGET_QUEUE_DEPTH: usize = 3;

/// Pop the next queued vehicle input command for a vehicle.
/// If the queue has grown beyond TARGET_QUEUE_DEPTH, drains excess
/// entries (keeping the latest few) so backlog never accumulates.
/// Returns None when no command is queued.
pub fn pop_next_vehicle_input(ctx: &ReducerContext, vehicle_id: u64) -> Option<VehicleControls> {
    let mut rows: Vec<VehicleInputCmd> = ctx
        .db
        .vehicle_input_cmd()
        .idx_vehicle_input_by_vehicle()
        .filter(&vehicle_id)
        .collect();

    if rows.is_empty() {
        return None;
    }

    rows.sort_by_key(|r| r.id);

    // If queue is larger than target, drain excess — keep only the
    // latest TARGET_QUEUE_DEPTH entries, pop the oldest of those.
    if rows.len() > TARGET_QUEUE_DEPTH {
        let drain_count = rows.len() - TARGET_QUEUE_DEPTH;
        for row in rows.drain(..drain_count) {
            ctx.db.vehicle_input_cmd().id().delete(&row.id);
        }
    }

    // Pop the oldest remaining entry
    let cmd = rows.remove(0);
    ctx.db.vehicle_input_cmd().id().delete(&cmd.id);
    Some(VehicleControls {
        forward: cmd.forward,
        strafe: cmd.strafe,
        lift: cmd.lift,
        yaw: cmd.yaw,
        boosting: cmd.boosting,
        seq: cmd.seq,
    })
}

/// Drain all queued inputs for a vehicle, returning the latest one.
/// Deletes all consumed rows. This prevents queue buildup when the
/// server tick rate drifts slightly behind the client input rate.
pub fn drain_vehicle_inputs(ctx: &ReducerContext, vehicle_id: u64) -> Option<VehicleControls> {
    let mut rows: Vec<VehicleInputCmd> = ctx
        .db
        .vehicle_input_cmd()
        .idx_vehicle_input_by_vehicle()
        .filter(&vehicle_id)
        .collect();

    if rows.is_empty() {
        return None;
    }

    // Sort by id (insertion order) — last entry is the most recent input
    rows.sort_by_key(|r| r.id);

    let latest = rows.last().unwrap();
    let result = VehicleControls {
        forward: latest.forward,
        strafe: latest.strafe,
        lift: latest.lift,
        yaw: latest.yaw,
        boosting: latest.boosting,
        seq: latest.seq,
    };

    // Delete all consumed rows
    for row in &rows {
        ctx.db.vehicle_input_cmd().id().delete(&row.id);
    }

    Some(result)
}

/// Drop old queued inputs if the queue grows too large.
pub fn trim_vehicle_input_queue(ctx: &ReducerContext, vehicle_id: u64) {
    let mut rows: Vec<VehicleInputCmd> = ctx
        .db
        .vehicle_input_cmd()
        .idx_vehicle_input_by_vehicle()
        .filter(&vehicle_id)
        .collect();
    if rows.len() <= MAX_INPUT_QUEUE_PER_VEHICLE {
        return;
    }
    rows.sort_by_key(|r| r.id);
    let drop_count = rows.len() - MAX_INPUT_QUEUE_PER_VEHICLE;
    for row in rows.into_iter().take(drop_count) {
        ctx.db.vehicle_input_cmd().id().delete(&row.id);
    }
}
