//! Run explicitly: cargo run --release -p fluenta-content --example benchmark_catalog.
use fluenta_content::{Catalog, reference, write_pack};
use fluenta_contracts::*;
use std::{path::Path, time::Instant};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let temporary = tempfile::tempdir()?;
    let paths = fluenta_content::compile_source(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("../../content/foundation"),
        temporary.path(),
    )?;
    let catalog = Catalog::open(temporary.path())?;
    let info = &catalog.packs[0];
    let mut pack = CoursePack {
        topics: vec![],
        missions: vec![],
        occurrences: vec![],
        schema_version: 2.try_into()?,
        release_id: "benchmark.large".to_owned().try_into()?,
        course: info.course.clone(),
        units: catalog.list(&info.release_id, "unit")?,
        lessons: catalog.list(&info.release_id, "lesson")?,
        objectives: catalog.list(&info.release_id, "objective")?,
        activities: catalog.list(&info.release_id, "activity")?,
        materials: catalog.list(&info.release_id, "material")?,
        speech: catalog.list(&info.release_id, "speech")?,
        vocabulary: catalog.list(&info.release_id, "vocabulary")?,
        rubrics: catalog.list(&info.release_id, "rubric")?,
        assessments: catalog.list(&info.release_id, "assessment")?,
        grammar: catalog.list(&info.release_id, "grammar")?,
    };
    for index in 0..50_000 {
        pack.materials.push(Material{content:reference(&format!("benchmark.reference.{index}")),searchable:true,blocks:vec![Block::Paragraph{spans:vec![Text{annotations:vec![],language:pack.course.source_language.language(),text:format!("School Spanish reference entry {index}. Grammar vocabulary lectura escritura.")}]}]});
    }
    let start = Instant::now();
    let path = temporary.path().join("large.sqlite");
    write_pack(&pack, &path)?;
    let build = start.elapsed();
    drop(catalog);
    drop(pack);
    for path in paths {
        std::fs::remove_file(path)?;
    }
    let start = Instant::now();
    let catalog = Catalog::open(temporary.path())?;
    let open = start.elapsed();
    let start = Instant::now();
    let hits = catalog.search(catalog.packs[0].course.source_language, "lectura")?;
    let search = start.elapsed();
    assert_eq!(hits.len(), 20);
    let start = Instant::now();
    let units = catalog.unit_overviews(catalog.packs[0].course.source_language)?;
    let overview = start.elapsed();
    assert!(!units.is_empty());
    println!(
        "50,000 extra reference entries · {:.1} MiB\nCompile: {build:?}\nCatalog open: {open:?}\nIndexed search (20 results): {search:?}\nCompiled unit overview: {overview:?}",
        path.metadata()?.len() as f64 / 1048576.0
    );
    assert!(
        search.as_secs() < 2,
        "indexed search exceeded the 2-second smoke-test budget"
    );
    Ok(())
}
