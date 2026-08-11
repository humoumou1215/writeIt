use serde::Serialize;
use std::{
  fs,
  path::{Path, PathBuf},
  sync::Mutex,
};

use tauri::State;

// ---------- 类型 ----------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
  pub name: String,
  pub path: String,
  pub kind: &'static str,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub children: Option<Vec<FsEntry>>,
}

#[derive(Default)]
pub struct AppState {
  root: Mutex<Option<PathBuf>>,
}

// ---------- 工具 ----------

fn is_editable(name: &str) -> bool {
  let lower = name.to_lowercase();
  lower.ends_with(".md") || lower.ends_with(".markdown") || lower.ends_with(".txt")
}

/// 把相对路径解析到根目录下，并校验不越界
fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
  let p = root.join(rel.trim_start_matches('/'));
  if !p.starts_with(root) {
    return Err("路径越界".into());
  }
  Ok(p)
}

fn walk(dir: &Path, root: &Path, show_all: bool) -> Vec<FsEntry> {
  let mut entries = Vec::new();
  if let Ok(rd) = fs::read_dir(dir) {
    for e in rd.flatten() {
      let name = e.file_name().to_string_lossy().to_string();
      if name.starts_with('.') {
        continue; // 隐藏文件默认跳过
      }
      let rel = e
        .path()
        .strip_prefix(root)
        .unwrap_or(&e.path())
        .to_string_lossy()
        .replace('\\', "/");
      let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
      if is_dir {
        entries.push(FsEntry {
          name: name.clone(),
          path: rel,
          kind: "dir",
          children: Some(walk(&e.path(), root, show_all)),
        });
      } else if show_all || is_editable(&name) {
        entries.push(FsEntry {
          name,
          path: rel,
          kind: "file",
          children: None,
        });
      }
    }
  }
  entries.sort_by(|a, b| match (a.kind, b.kind) {
    ("dir", "file") => std::cmp::Ordering::Less,
    ("file", "dir") => std::cmp::Ordering::Greater,
    _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
  });
  entries
}

// ---------- 命令 ----------

#[tauri::command]
fn set_root(state: State<'_, AppState>, path: String) -> Result<(), String> {
  let p = PathBuf::from(&path);
  if !p.is_dir() {
    return Err("目录不存在".into());
  }
  *state.root.lock().unwrap() = Some(p);
  Ok(())
}

#[tauri::command]
fn read_tree(state: State<'_, AppState>, show_all: bool) -> Result<Vec<FsEntry>, String> {
  let root = state
    .root
    .lock()
    .unwrap()
    .clone()
    .ok_or("尚未选择目录")?;
  Ok(walk(&root, &root, show_all))
}

#[tauri::command]
fn read_file(state: State<'_, AppState>, path: String) -> Result<String, String> {
  let root = state.root.lock().unwrap().clone().ok_or("尚未选择目录")?;
  let full = resolve(&root, &path)?;
  fs::read_to_string(&full).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(
  state: State<'_, AppState>,
  path: String,
  content: String,
) -> Result<(), String> {
  let root = state.root.lock().unwrap().clone().ok_or("尚未选择目录")?;
  let full = resolve(&root, &path)?;
  if let Some(parent) = full.parent() {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  fs::write(&full, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_file(state: State<'_, AppState>, path: String) -> Result<(), String> {
  let root = state.root.lock().unwrap().clone().ok_or("尚未选择目录")?;
  let full = resolve(&root, &path)?;
  if full.exists() {
    return Err("文件已存在".into());
  }
  if let Some(parent) = full.parent() {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  fs::write(&full, "").map_err(|e| e.to_string())
}

#[tauri::command]
fn create_dir(state: State<'_, AppState>, path: String) -> Result<(), String> {
  let root = state.root.lock().unwrap().clone().ok_or("尚未选择目录")?;
  let full = resolve(&root, &path)?;
  fs::create_dir_all(&full).map_err(|e| e.to_string())
}

#[tauri::command]
fn rename(
  state: State<'_, AppState>,
  old_path: String,
  new_path: String,
) -> Result<(), String> {
  let root = state.root.lock().unwrap().clone().ok_or("尚未选择目录")?;
  let from = resolve(&root, &old_path)?;
  let to = resolve(&root, &new_path)?;
  if !from.exists() {
    return Err("源路径不存在".into());
  }
  if let Some(parent) = to.parent() {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  fs::rename(&from, &to).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove(state: State<'_, AppState>, path: String) -> Result<(), String> {
  let root = state.root.lock().unwrap().clone().ok_or("尚未选择目录")?;
  let full = resolve(&root, &path)?;
  let meta = fs::metadata(&full).map_err(|e| e.to_string())?;
  if meta.is_dir() {
    fs::remove_dir_all(&full).map_err(|e| e.to_string())
  } else {
    fs::remove_file(&full).map_err(|e| e.to_string())
  }
}

// ---------- 注册 ----------

pub fn run() {
  tauri::Builder::default()
    .manage(AppState::default())
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
      set_root,
      read_tree,
      read_file,
      write_file,
      create_file,
      create_dir,
      rename,
      remove,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
