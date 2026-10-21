use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::ipc::Response;

#[derive(Serialize)]
struct FileEntry {
    path: String,
    name: String,
    size: u64,
}

fn wanted(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    if n.starts_with("~$") {
        return false; // Excel lock files
    }
    n.ends_with(".step") || n.ends_with(".stp") || n.ends_with(".xls") || n.ends_with(".xlsx") || n.ends_with(".xlsm")
}

fn walk(dir: &Path, depth: usize, out: &mut Vec<FileEntry>) {
    if depth > 8 {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        let p: PathBuf = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            walk(&p, depth + 1, out);
        } else if meta.is_file() {
            let name = entry.file_name().to_string_lossy().to_string();
            if wanted(&name) {
                out.push(FileEntry { path: p.to_string_lossy().to_string(), name, size: meta.len() });
            }
        }
    }
}

/// Recursively lists STEP and BOM files under `path`.
#[tauri::command]
fn scan_folder(path: String) -> Result<Vec<FileEntry>, String> {
    let root = Path::new(&path);
    if !root.is_dir() {
        return Err(format!("No es una carpeta: {path}"));
    }
    let mut out = Vec::new();
    walk(root, 0, &mut out);
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

/// Returns raw bytes (sent to JS as an ArrayBuffer, no JSON overhead).
#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    fs::read(&path).map(Response::new).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn write_text(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| format!("{path}: {e}"))
}

/// Folder passed on the command line (e.g. "Open with Nesting Studio"), if any.
#[tauri::command]
fn startup_folder() -> Option<String> {
    std::env::args().skip(1).find(|a| Path::new(a).is_dir())
}

/// A saved work (.nesting) passed on the command line, e.g. by double-clicking it.
#[tauri::command]
fn startup_file() -> Option<String> {
    std::env::args().skip(1).find(|a| a.to_lowercase().ends_with(".nesting") && Path::new(a).is_file())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![scan_folder, read_file, write_text, startup_folder, startup_file])
        .run(tauri::generate_context!())
        .expect("error al iniciar Nesting Studio");
}
