use crate::tables::vehicle_input_cmd;
use crate::tables::VehicleInputCmd;
use spacetimedb::ReducerContext;

// Keep queue short so controls stay real-time under transient stalls.
// At 30Hz vehicle tick, 12 commands caps control lag to ~400ms.
const MAX_INPUT_QUEUE_PER_VEHICLE: usize = 12;

#[derive(Clone)]
pub struct VehicleControls {
    pub forward: f32,
    pub strafe: f32,
    pub lift: f32,
    pub yaw: f32,
    pub boosting: bool,
    pub seq: u32,
}

/// Pop the next queued vehicle input command for a vehicle.
/// Returns None when no command is queued.
pub fn pop_next_vehicle_input(ctx: &ReducerContext, vehicle_id: u64) -> Option<VehicleControls> {
    let mut best: Option<VehicleInputCmd> = None;
    for row in ctx
        .db
        .vehicle_input_cmd()
        .idx_vehicle_input_by_vehicle()
        .filter(&vehicle_id)
    {
        if best.as_ref().map_or(true, |b| row.id < b.id) {
            best = Some(row);
        }
    }

    let cmd = best?;
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
