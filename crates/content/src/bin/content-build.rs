use std::{env, path::Path};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let arguments: Vec<_> = env::args().collect();
    if arguments.len() != 3 {
        return Err("usage: content-build <source directory> <output directory>".into());
    }
    for path in fluenta_content::compile_source(Path::new(&arguments[1]), Path::new(&arguments[2]))?
    {
        println!("{}", path.display());
    }
    Ok(())
}
