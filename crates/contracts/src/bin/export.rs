use fluenta_contracts::{Activity, CoursePack, Event, Request, Response, TutorContext};
use schemars::schema_for;
use std::{error::Error, fs, path::PathBuf};

#[derive(schemars::JsonSchema)]
#[allow(dead_code)]
struct Protocol {
    request: Request,
    response: Response,
    event: Event,
    tutor_context: TutorContext,
    course_pack: CoursePack,
    studio_request: fluenta_contracts::StudioRequest,
    studio_response: fluenta_contracts::StudioResponse,
}

fn main() -> Result<(), Box<dyn Error>> {
    let destination = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("schema");
    fs::create_dir_all(&destination)?;
    for (name, schema) in [
        ("activity", schema_for!(Activity)),
        ("course-pack", schema_for!(CoursePack)),
        ("request", schema_for!(Request)),
        ("response", schema_for!(Response)),
        ("event", schema_for!(Event)),
        ("tutor-context", schema_for!(TutorContext)),
        ("protocol", schema_for!(Protocol)),
    ] {
        fs::write(
            destination.join(format!("{name}.schema.json")),
            format!("{}\n", serde_json::to_string_pretty(&schema)?),
        )?;
    }
    println!("Exported contracts to {}", destination.display());
    Ok(())
}
