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
      if !show_all && name.starts_with('.') {
        continue; // 隐藏文件默认跳过；showAll=true 时保留（.template 模板目录等需要可见）
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
      } else {
        // 所有文件类型都展示（非可编辑文件仅展示，不支持打开/编辑）
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
  if to.exists() && from != to {
    return Err("目标已存在".into());
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

/// 在系统文件管理器中显示路径：文件 → 打开所在目录并选中；目录 → 在父级中选中
#[tauri::command]
fn reveal_in_explorer(state: State<AppState>, path: String) -> Result<(), String> {
  let root = state.root.lock().unwrap().clone().ok_or("尚未选择目录")?;
  let full = resolve(&root, &path)?;
  if !full.exists() {
    return Err("路径不存在".into());
  }
  show_in_folder(&full)
}

/// 平台相关：用系统文件管理器显示并选中目标
fn show_in_folder(path: &Path) -> Result<(), String> {
  #[cfg(target_os = "windows")]
  {
    // explorer /select,<path>：打开所在目录并选中文件/文件夹
    std::process::Command::new("explorer")
      .arg(format!("/select,{}", path.display()))
      .spawn()
      .map_err(|e| format!("打开文件管理器失败: {e}"))?;
  }
  #[cfg(target_os = "macos")]
  {
    // open -R <path>：在 Finder 中显示并选中
    std::process::Command::new("open")
      .arg("-R")
      .arg(path)
      .spawn()
      .map_err(|e| format!("打开访达失败: {e}"))?;
  }
  #[cfg(target_os = "linux")]
  {
    // Linux 无统一的「选中」方式：目录直接打开；文件打开所在目录
    let dir = if path.is_dir() {
      path.to_path_buf()
    } else {
      path.parent().unwrap_or(path).to_path_buf()
    };
    std::process::Command::new("xdg-open")
      .arg(dir)
      .spawn()
      .map_err(|e| format!("打开文件管理器失败: {e}"))?;
  }
  #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
  {
    return Err("当前平台暂不支持".into());
  }
  Ok(())
}

// ---------- 导出（保存对话框给的绝对路径，不走 resolve） ----------

#[tauri::command]
fn save_binary(state: State<AppState>, path: String, base64: String) -> Result<(), String> {
  use base64::engine::general_purpose::STANDARD as B64;
  use base64::Engine as _;
  let bytes = B64.decode(base64).map_err(|e| format!("base64 解码失败: {e}"))?;
  let _ = state.root.lock().unwrap().clone().ok_or("尚未选择目录")?;
  let p = PathBuf::from(&path);
  if let Some(parent) = p.parent() {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  fs::write(&p, bytes).map_err(|e| e.to_string())
}

// ---------- Git 命令（M11 Git 工作台）----------
// 全部走 git CLI（延续 git_user_name），--no-color + -z + UTF-8；中文路径 core.quotepath=false

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoInfo {
  pub is_repo: bool,
  pub branch: Option<String>,
  pub head_hash: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
  pub name: String,
  pub is_current: bool,
  pub remote: Option<String>,
  pub ahead_behind: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatus {
  pub path: String,
  /// M 修改 / A 新增 / D 删除 / U 未合并 / ? 未跟踪 / R 重命名
  pub status: String,
  pub added: i64,
  pub deleted: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
  pub hash: String,
  /// 父提交 hash（空格分隔，M15：提交图画分叉/合并线；首提交为空）
  pub parents: Vec<String>,
  pub author: String,
  pub date: i64,
  pub message: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitFile {
  pub path: String,
  pub status: String,
  pub added: i64,
  pub deleted: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitShowCommit {
  pub hash: String,
  pub author: String,
  pub date: i64,
  pub message: String,
  pub files: Vec<GitCommitFile>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
  pub kind: String, // add | del | ctx
  pub text: String,
  /// 词级高亮（M11b）：修改对中 common 词 kind=ctx，变更词 kind=add/del；None = 无词级数据
  #[serde(skip_serializing_if = "Option::is_none")]
  pub words: Option<Vec<DiffWord>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiffWord {
  pub kind: String, // add | del | ctx
  pub text: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
  pub old_start: i64,
  pub old_lines: i64,
  pub new_start: i64,
  pub new_lines: i64,
  pub lines: Vec<DiffLine>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffResult {
  pub hunks: Vec<DiffHunk>,
  pub added: i64,
  pub deleted: i64,
  /// 目标文件当前是否存在于磁盘（删除文件的空态）
  pub exists: bool,
}

fn run_git(root: &Path, args: &[&str]) -> Result<std::process::Output, String> {
  std::process::Command::new("git")
    .args(args)
    .current_dir(root)
    .output()
    .map_err(|e| format!("git 执行失败: {e}"))
}

fn is_git_repo(root: &Path) -> bool {
  root.join(".git").exists()
}

fn git_root(state: &State<'_, AppState>) -> Result<PathBuf, String> {
  let root = state.root.lock().unwrap().clone().ok_or("尚未选择目录")?;
  if !is_git_repo(&root) {
    return Err("当前目录不是 Git 仓库".into());
  }
  Ok(root)
}

#[tauri::command]
fn git_repo_info(state: State<AppState>) -> GitRepoInfo {
  let root = state.root.lock().unwrap().clone();
  let Some(root) = root else {
    return GitRepoInfo { is_repo: false, branch: None, head_hash: None };
  };
  if !is_git_repo(&root) {
    return GitRepoInfo { is_repo: false, branch: None, head_hash: None };
  }
  let branch = run_git(&root, &["branch", "--show-current"])
    .ok()
    .filter(|o| o.status.success())
    .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    .filter(|s| !s.is_empty());
  let head_hash = run_git(&root, &["rev-parse", "HEAD"])
    .ok()
    .filter(|o| o.status.success())
    .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    .filter(|s| !s.is_empty());
  GitRepoInfo { is_repo: true, branch, head_hash }
}

#[tauri::command]
fn git_branches(state: State<AppState>) -> Result<Vec<GitBranch>, String> {
  let root = git_root(&state)?;
  let out = run_git(
    &root,
    &[
      "for-each-ref",
      "--format=%(refname:short)%1f%(HEAD)%1f%(upstream:short)%1f%(upstream:track)",
      "refs/heads",
      "refs/remotes",
    ],
  )?;
  if !out.status.success() {
    return Err(String::from_utf8_lossy(&out.stderr).trim().into());
  }
  let text = String::from_utf8_lossy(&out.stdout);
  let mut branches = Vec::new();
  for line in text.lines() {
    let parts: Vec<&str> = line.split('\u{1f}').collect();
    if parts.len() < 2 {
      continue;
    }
    branches.push(GitBranch {
      name: parts[0].to_string(),
      is_current: parts[1] == "*",
      remote: if parts.len() > 2 && !parts[2].is_empty() {
        Some(parts[2].to_string())
      } else {
        None
      },
      ahead_behind: if parts.len() > 3 && !parts[3].is_empty() {
        Some(parts[3].to_string())
      } else {
        None
      },
    });
  }
  Ok(branches)
}

#[tauri::command]
fn git_status(state: State<AppState>) -> Result<Vec<GitFileStatus>, String> {
  let root = git_root(&state)?;
  let out = run_git(&root, &["status", "--porcelain=v1", "-z"])?;
  if !out.status.success() {
    return Err(String::from_utf8_lossy(&out.stderr).trim().into());
  }
  let bytes = out.stdout;
  let mut files: Vec<GitFileStatus> = parse_porcelain(&bytes)
    .into_iter()
    .map(|(status, path)| GitFileStatus { path, status, added: -1, deleted: -1 })
    .collect();
  // 行数统计：git diff --numstat HEAD（工作区 vs HEAD 全量；untracked 不在内）
  let nums = run_git(&root, &["diff", "--numstat", "HEAD"]);
  if let Ok(nums) = nums {
    if nums.status.success() {
      let num_text = String::from_utf8_lossy(&nums.stdout);
      for line in num_text.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 3 {
          continue;
        }
        let add: i64 = parts[0].trim().parse().unwrap_or(-1);
        let del: i64 = parts[1].trim().parse().unwrap_or(-1);
        let p = parts[2].to_string();
        if let Some(f) = files.iter_mut().find(|f| f.path == p) {
          f.added = add;
          f.deleted = del;
        }
      }
    }
  }
  // untracked：读文件行数（正常笔记文件不大）
  for f in files.iter_mut() {
    if f.status == "?" && f.added < 0 {
      if let Ok(full) = resolve(&root, &f.path) {
        if let Ok(s) = fs::read_to_string(&full) {
          f.added = s.lines().count() as i64;
          f.deleted = 0;
        }
      }
    }
  }
  Ok(files)
}

#[tauri::command]
fn git_log(state: State<AppState>, limit: Option<i64>, branch: Option<String>) -> Result<Vec<GitCommit>, String> {
  let root = git_root(&state)?;
  let n = limit.unwrap_or(50).clamp(1, 500);
  let n_str = n.to_string();
  let mut args = vec!["log", "-n", n_str.as_str(), "--format=%H%x1f%P%x1f%an%x1f%at%x1f%s%x1e"];
  if let Some(b) = &branch {
    args.push(b.as_str());
  }
  let out = run_git(&root, &args)?;
  if !out.status.success() {
    return Err(String::from_utf8_lossy(&out.stderr).trim().into());
  }
  let text = String::from_utf8_lossy(&out.stdout);
  let mut commits = Vec::new();
  for rec in text.split('\u{1e}') {
    let parts: Vec<&str> = rec.split('\u{1f}').collect();
    if parts.len() < 5 || parts[0].is_empty() {
      continue;
    }
    commits.push(GitCommit {
      hash: parts[0].to_string(),
      parents: parts[1].split_whitespace().map(|s| s.to_string()).collect(),
      author: parts[2].to_string(),
      date: parts[3].trim().parse().unwrap_or(0),
      message: parts[4].to_string(),
    });
  }
  Ok(commits)
}

#[tauri::command]
fn git_show_commit(state: State<AppState>, hash: String) -> Result<GitShowCommit, String> {
  let root = git_root(&state)?;
  let out = run_git(&root, &["log", "-1", "--format=%H%x1f%an%x1f%at%x1f%s%x1e", &hash])?;
  if !out.status.success() {
    return Err(String::from_utf8_lossy(&out.stderr).trim().into());
  }
  let text = String::from_utf8_lossy(&out.stdout);
  let mut it = text.split('\u{1e}');
  let header = it.next().unwrap_or("");
  let hparts: Vec<&str> = header.split('\u{1f}').collect();
  if hparts.len() < 4 || hparts[0].is_empty() {
    return Err(format!("提交不存在：{hash}"));
  }
  // 文件列表：diff-tree --name-status（带 rename 检测）
  let nout = run_git(&root, &["diff-tree", "--name-status", "-r", "--root", "-M", &hash])?;
  let mut status_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
  if nout.status.success() {
    for line in String::from_utf8_lossy(&nout.stdout).lines() {
      let mut parts = line.split('\t');
      let st = parts.next().unwrap_or("").to_string();
      let p = parts.next().unwrap_or("").to_string();
      if st.is_empty() || p.is_empty() {
        continue;
      }
      if let Some(code) = st.chars().next() {
        // R100 → R；文件路径取 new（rename 的第二段）
        let key = if code == 'R' || code == 'C' { parts.next().unwrap_or(&p).to_string() } else { p };
        status_map.insert(key, if code == 'R' { "R".into() } else if code == 'A' { "A".into() } else if code == 'D' { "D".into() } else { "M".into() });
      }
    }
  }
  // 行数：diff-tree --numstat（rename 路径为 `old => new`，取 new）
  let mout = run_git(&root, &["diff-tree", "--numstat", "-r", "--root", "-M", &hash])?;
  let mut num_map: std::collections::HashMap<String, (i64, i64)> = std::collections::HashMap::new();
  if mout.status.success() {
    for line in String::from_utf8_lossy(&mout.stdout).lines() {
      let parts: Vec<&str> = line.split('\t').collect();
      if parts.len() < 3 {
        continue;
      }
      let add: i64 = parts[0].trim().parse().unwrap_or(-1);
      let del: i64 = parts[1].trim().parse().unwrap_or(-1);
      let p = parts[2].to_string();
      let key = match p.rsplit_once(" => ") {
        Some((_, new)) => new.to_string(),
        None => p,
      };
      num_map.insert(key, (add, del));
    }
  }
  let mut keys: Vec<&String> = status_map.keys().collect();
  keys.sort();
  let mut files = Vec::new();
  for k in keys {
    let (add, del) = num_map.get(k).copied().unwrap_or((-1, -1));
    files.push(GitCommitFile {
      path: k.clone(),
      status: status_map.get(k).cloned().unwrap_or_else(|| "M".into()),
      added: add,
      deleted: del,
    });
  }
  Ok(GitShowCommit {
    hash: hparts[0].to_string(),
    author: hparts[1].to_string(),
    date: hparts[2].trim().parse().unwrap_or(0),
    message: hparts[3].to_string(),
    files,
  })
}

fn parse_hunk_header(line: &str) -> Option<DiffHunk> {
  // @@ -oldStart,oldLines +newStart,newLines @@（行数缺省为 1）
  let rest = line.trim_start_matches("@@").trim_end_matches("@@").trim();
  let mut parts = rest.split_whitespace();
  let old = parts.next()?.trim_start_matches('-');
  let new = parts.next()?.trim_start_matches('+');
  let mut old_it = old.split(',');
  let old_start: i64 = old_it.next()?.parse().ok()?;
  let old_lines: i64 = old_it.next().and_then(|s| s.parse().ok()).unwrap_or(1);
  let mut new_it = new.split(',');
  let new_start: i64 = new_it.next()?.parse().ok()?;
  let new_lines: i64 = new_it.next().and_then(|s| s.parse().ok()).unwrap_or(1);
  Some(DiffHunk { old_start, old_lines, new_start, new_lines, lines: Vec::new() })
}

/// 解析 unified diff 文本（git diff --no-color -U3 输出）→ hunks + 统计
/// words（词级 token 行组，从 --word-diff=porcelain 解析）按 (kind, text) 匹配合并到每行
/// 词级「line3 → line3 new」会被 porcelain 识别为纯新增（unified 却是整行替换），
/// 行数不一致 → 用文本+类型匹配而非顺序索引，匹配不上则行级降级。
fn parse_unified_diff(text: &str, word_groups: Option<Vec<Vec<DiffWord>>>) -> (Vec<DiffHunk>, i64, i64) {
  use std::collections::VecDeque;
  // 词级行队列：(kind, 拼接文本, tokens)
  let mut word_rows: VecDeque<(String, String, Vec<DiffWord>)> = VecDeque::new();
  if let Some(groups) = word_groups {
    for (k, toks) in groups_to_rows(groups) {
      let joined = toks.iter().map(|w| w.text.as_str()).collect::<String>();
      word_rows.push_back((k, joined, toks));
    }
  }
  let mut hunks: Vec<DiffHunk> = Vec::new();
  let mut added = 0i64;
  let mut deleted = 0i64;
  let mut cur: Option<DiffHunk> = None;
  for line in text.lines() {
    if let Some(stripped) = line.strip_prefix("@@") {
      if let Some(h) = cur.take() {
        hunks.push(h);
      }
      if stripped.contains("@@") {
        cur = parse_hunk_header(line);
      }
    } else if let Some(h) = cur.as_mut() {
      let (kind, content) = if let Some(c) = line.strip_prefix('+') {
        ("add", c.to_string())
      } else if let Some(c) = line.strip_prefix('-') {
        ("del", c.to_string())
      } else if let Some(c) = line.strip_prefix(' ') {
        ("ctx", c.to_string())
      } else {
        continue; // "\\ No newline at end of file" 等元行
      };
      if kind == "add" {
        added += 1;
      } else if kind == "del" {
        deleted += 1;
      }
      // 词级：队列中第一个 (kind, text) 匹配项（贪心；重复行按序）
      let mut words = None;
      if let Some(pos) = word_rows.iter().position(|(k, t, _)| k == kind && t == &content) {
        if let Some((_, _, toks)) = word_rows.remove(pos) {
          words = Some(toks);
        }
      }
      h.lines.push(DiffLine { kind: kind.into(), text: content, words });
    }
  }
  if let Some(h) = cur.take() {
    hunks.push(h);
  }
  (hunks, added, deleted)
}

/// 解析 git status --porcelain=v1 -z 输出 → (状态码, 显示路径)
/// rename/复制有两记录：R old\0new\0 → 显示 "old → new"
fn parse_porcelain(bytes: &[u8]) -> Vec<(String, String)> {
  let mut files = Vec::new();
  let mut i = 0;
  while i < bytes.len() {
    let end = bytes[i..]
      .iter()
      .position(|&b| b == 0)
      .map(|p| i + p)
      .unwrap_or(bytes.len());
    let rec = String::from_utf8_lossy(&bytes[i..end]).to_string();
    i = end + 1;
    if rec.len() < 3 {
      continue;
    }
    let xy = &rec[0..2];
    let path = rec[3..].to_string();
    let st = xy.trim();
    if st == "R" || st == "C" {
      let end2 = bytes[i..]
        .iter()
        .position(|&b| b == 0)
        .map(|p| i + p)
        .unwrap_or(bytes.len());
      let new_path = String::from_utf8_lossy(&bytes[i..end2]).to_string();
      i = end2 + 1;
      files.push((st.to_string(), format!("{path} → {new_path}")));
      continue;
    }
    let status = if st.contains('?') {
      "?".to_string()
    } else if st.contains('U') {
      "U".to_string()
    } else {
      match st.chars().last() {
        Some('M') => "M".to_string(),
        Some('A') => "A".to_string(),
        Some('D') => "D".to_string(),
        _ => "M".to_string(),
      }
    };
    files.push((status, path));
  }
  files
}

/// 解析 git diff --word-diff=porcelain 输出 → 每行组的词 token 列表
/// porcelain 格式：每 token 一行（前缀 ' '='common' '+'='add' '-'='del'），'~' 单独行 = 行边界
/// diff 头部/元信息行（diff --git / index / --- / +++ / @@）无前缀，直接跳过
fn parse_word_groups(text: &str) -> Vec<Vec<DiffWord>> {
  let mut groups: Vec<Vec<DiffWord>> = Vec::new();
  let mut cur: Vec<DiffWord> = Vec::new();
  for line in text.lines() {
    if line == "~" {
      groups.push(std::mem::take(&mut cur));
      continue;
    }
    if line.is_empty()
      || line.starts_with("diff --git")
      || line.starts_with("index ")
      || line.starts_with("--- ")
      || line.starts_with("+++ ")
      || line.starts_with("@@")
    {
      continue;
    }
    let (kind, content) = match line.as_bytes()[0] {
      b'+' => ("add", &line[1..]),
      b'-' => ("del", &line[1..]),
      _ => ("ctx", &line[1..]),
    };
    cur.push(DiffWord { kind: kind.into(), text: content.to_string() });
  }
  if !cur.is_empty() {
    groups.push(cur);
  }
  groups
}

/// 把词 token 行组展开为 diff 行序列（del+add 同组 → 2 行），供与 unified 行对齐
fn groups_to_rows(groups: Vec<Vec<DiffWord>>) -> Vec<(String, Vec<DiffWord>)> {
  let mut rows: Vec<(String, Vec<DiffWord>)> = Vec::new();
  for g in groups {
    let has_del = g.iter().any(|w| w.kind == "del");
    let has_add = g.iter().any(|w| w.kind == "add");
    let common = |k: &str| {
      g.iter()
        .filter(|w| w.kind == "ctx" || w.kind == k)
        .cloned()
        .collect::<Vec<_>>()
    };
    if has_del && has_add {
      rows.push(("del".into(), common("del")));
      rows.push(("add".into(), common("add")));
    } else if has_del {
      rows.push(("del".into(), common("del")));
    } else if has_add {
      rows.push(("add".into(), common("add")));
    } else if !g.is_empty() {
      rows.push(("ctx".into(), g));
    }
  }
  rows
}

#[cfg(test)]
mod git_parse_tests {
  use super::*;

  #[test]
  fn hunk_header_basic() {
    let h = parse_hunk_header("@@ -1,3 +1,4 @@").unwrap();
    assert_eq!((h.old_start, h.old_lines, h.new_start, h.new_lines), (1, 3, 1, 4));
    // 行数缺省 = 1
    let h = parse_hunk_header("@@ -5 +7 @@").unwrap();
    assert_eq!((h.old_start, h.old_lines, h.new_start, h.new_lines), (5, 1, 7, 1));
    // 零行范围（纯删除/纯新增）：-1,0 / +1,0
    let h = parse_hunk_header("@@ -1,0 +1,2 @@").unwrap();
    assert_eq!((h.old_start, h.old_lines, h.new_start, h.new_lines), (1, 0, 1, 2));
  }

  #[test]
  fn unified_diff_basic() {
    let text = "diff --git a/a.md b/a.md\n\
index 111..222 100644\n\
--- a/a.md\n\
+++ b/a.md\n\
@@ -1,3 +1,4 @@\n 标题\n-旧行\n+新行\n+新增行\n 上下文\n";
    let (hunks, added, deleted) = parse_unified_diff(text, None);
    assert_eq!(hunks.len(), 1);
    assert_eq!(added, 2);
    assert_eq!(deleted, 1);
    let kinds: Vec<&str> = hunks[0].lines.iter().map(|l| l.kind.as_str()).collect();
    assert_eq!(kinds, vec!["ctx", "del", "add", "add", "ctx"]);
    assert_eq!(hunks[0].lines[1].text, "旧行");
    assert_eq!(hunks[0].lines[2].text, "新行");
  }

  #[test]
  fn unified_diff_multiple_hunks() {
    let text = "@@ -1,2 +1,2 @@\n\
 a\n\
-b\n\
+c\n\
@@ -10,1 +10,2 @@\n\
 x\n\
+y\n";
    let (hunks, added, deleted) = parse_unified_diff(text, None);
    assert_eq!(hunks.len(), 2);
    assert_eq!(added, 2);
    assert_eq!(deleted, 1);
    assert_eq!(hunks[1].old_start, 10);
    assert_eq!(hunks[1].new_start, 10);
  }

  #[test]
  fn unified_diff_metadata_lines_ignored() {
    // \\ No newline at end of file 等元行应被忽略，不计入行
    let text = "@@ -1,1 +1,1 @@\n\
-old\n\
\\ No newline at end of file\n\
+new\n";
    let (hunks, added, deleted) = parse_unified_diff(text, None);
    assert_eq!(added, 1);
    assert_eq!(deleted, 1);
    assert_eq!(hunks[0].lines.len(), 2);
  }

  #[test]
  fn word_groups_basic() {
    // 含 diff 头部元行（应被过滤）
    let text = "diff --git a/a.md b/a.md\n\
index 520d408..8b3d216 100644\n\
--- a/a.md\n\
+++ b/a.md\n\
@@ -1,3 +1,3 @@\n hello \n-world\n+WORLd\n foo\n~\n bar baz\n~\n line3 \n+new\n~\n";
    let groups = parse_word_groups(text);
    assert_eq!(groups.len(), 3);
    // 组1：修改对（hello / -world / +WORLd / foo）
    let rows = groups_to_rows(groups);
    assert_eq!(rows.len(), 4); // del + add + ctx + (line3 修改对 → 2 行)
    assert_eq!(rows[0].0, "del");
    assert_eq!(rows[1].0, "add");
    assert_eq!(rows[2].0, "ctx");
    // del 行 words：common + del（porcelain token 含空白，"hello " 是单个 token）
    let w0: Vec<&str> = rows[0].1.iter().map(|w| w.kind.as_str()).collect();
    assert_eq!(w0, vec!["ctx", "del", "ctx"]);
    assert_eq!(rows[0].1[0].text, "hello ");
    assert_eq!(rows[0].1[1].text, "world");
    assert_eq!(rows[0].1[2].text, "foo");
    let w1: Vec<&str> = rows[1].1.iter().map(|w| w.kind.as_str()).collect();
    assert_eq!(w1, vec!["ctx", "add", "ctx"]);
    assert_eq!(rows[1].1[1].text, "WORLd");
    // 纯新增行
    assert_eq!(rows[3].0, "add");
    assert_eq!(rows[3].1.last().unwrap().text, "new");
  }

  #[test]
  fn porcelain_basic() {
    let bytes = b" M a.md\0A  b.md\0?? c.md\0D  old.md\0";
    let files = parse_porcelain(bytes);
    assert_eq!(files.len(), 4);
    assert_eq!(files[0], ("M".into(), "a.md".into()));
    assert_eq!(files[1], ("A".into(), "b.md".into()));
    assert_eq!(files[2], ("?".into(), "c.md".into()));
    assert_eq!(files[3], ("D".into(), "old.md".into()));
  }

  #[test]
  fn porcelain_rename() {
    // R old\0new\0 → 显示 "old → new"
    let bytes = b"R  old.md\0new.md\0";
    let files = parse_porcelain(bytes);
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].0, "R");
    assert_eq!(files[0].1, "old.md → new.md");
  }

  #[test]
  fn porcelain_chinese_paths() {
    // 中文路径（-z 下原样输出，不转义）
    let bytes = " M 中文.md\0".as_bytes();
    let files = parse_porcelain(bytes);
    assert_eq!(files[0].1, "中文.md");
  }

  #[test]
  fn extract_hunk_patch_basic() {
    let text = "diff --git a/x.md b/x.md\nindex 111..222 100644\n--- a/x.md\n+++ b/x.md\n@@ -1 +1,2 @@\n-a\n+b\n+c\n@@ -5 +7 @@\n d\n+e\n";
    let p0 = extract_hunk_patch(text, 0).unwrap();
    assert!(p0.starts_with("diff --git a/x.md"));
    assert!(p0.contains("@@ -1 +1,2 @@"));
    assert!(p0.contains("-a\n+b\n+c"));
    assert!(!p0.contains("@@ -5"));
    let p1 = extract_hunk_patch(text, 1).unwrap();
    assert!(p1.contains("@@ -5 +7 @@"));
    assert!(!p1.contains("@@ -1 +1"));
    assert!(extract_hunk_patch(text, 5).is_none());
  }

  /// 真实 git：-U0 diff → 提取单 hunk → git apply --reverse → 验证该 hunk 已还原
  #[test]
  fn discard_hunk_real_git() {
    use std::fs;
    use std::io::Write;
    use std::process::Command;
    let dir = std::env::temp_dir().join(format!("writeit-git-hunk-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let run = |args: &[&str]| {
      let out = Command::new("git").args(args).current_dir(&dir).output().unwrap();
      assert!(out.status.success(), "git {:?}: {}", args, String::from_utf8_lossy(&out.stderr));
      String::from_utf8_lossy(&out.stdout).to_string()
    };
    run(&["init", "-q"]);
    run(&["config", "user.email", "t@t"]);
    run(&["config", "user.name", "t"]);
    fs::write(dir.join("x.md"), "line1\nline2\nline3\nline4\nline5\n").unwrap();
    run(&["add", "."]);
    run(&["commit", "-qm", "init"]);
    // 两处改动（两个 hunk）
    fs::write(dir.join("x.md"), "line1 CHANGED\nline2\nline3\nline4 CHANGED\nline5\n").unwrap();
    let diff = run(&["diff", "--no-color", "-U0", "HEAD", "--", "x.md"]);
    let patch0 = extract_hunk_patch(&diff, 0).unwrap();
    let patch1 = extract_hunk_patch(&diff, 1).unwrap();
    // 反向应用 hunk0 → 第一处改动还原，第二处保留
    let apply = |patch: &str| {
      let mut child = Command::new("git")
        .args(["apply", "--reverse", "--unidiff-zero", "-"])
        .current_dir(&dir)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .unwrap();
      child.stdin.take().unwrap().write_all(patch.as_bytes()).unwrap();
      let out = child.wait_with_output().unwrap();
      assert!(out.status.success(), "apply: {}", String::from_utf8_lossy(&out.stderr));
    };
    apply(&patch0);
    let now = fs::read_to_string(dir.join("x.md")).unwrap();
    assert!(now.contains("line1\n"), "hunk0 应还原，实际: {:?}", now);
    assert!(now.contains("line4 CHANGED"), "hunk1 应保留: {:?}", now);
    apply(&patch1);
    let now = fs::read_to_string(dir.join("x.md")).unwrap();
    assert_eq!(now, "line1\nline2\nline3\nline4\nline5\n");
    let _ = fs::remove_dir_all(&dir);
  }

  /// 真实 git 集成：建临时仓库 → 提交 → 改动 → unified + porcelain 合并对齐
  #[test]
  fn word_merge_real_git() {
    use std::fs;
    use std::process::Command;
    let dir = std::env::temp_dir().join(format!("writeit-git-test-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let run = |args: &[&str]| {
      let out = Command::new("git").args(args).current_dir(&dir).output().unwrap();
      assert!(out.status.success(), "git {:?} failed: {}", args, String::from_utf8_lossy(&out.stderr));
      String::from_utf8_lossy(&out.stdout).to_string()
    };
    run(&["init", "-q"]);
    run(&["config", "user.email", "t@t"]);
    run(&["config", "user.name", "t"]);
    fs::write(dir.join("a.md"), "hello world foo\nbar baz\nline3\n").unwrap();
    run(&["add", "."]);
    run(&["commit", "-qm", "init"]);
    fs::write(dir.join("a.md"), "hello WORLd foo\nbar baz\nline3 new\n").unwrap();
    let u = run(&["diff", "--no-color", "-U3", "--", "a.md"]);
    let p = run(&["diff", "--word-diff=porcelain", "--no-color", "-U3", "--", "a.md"]);
    let groups = parse_word_groups(&p);
    let (hunks, added, deleted) = parse_unified_diff(&u, Some(groups));
    assert_eq!(added, 2);
    assert_eq!(deleted, 2);
    // 5 行：del + add + ctx + del + add
    let flat: Vec<(&DiffLine, String)> = hunks
      .iter()
      .flat_map(|h| h.lines.iter().map(|l| (l, format!("{:?}", l.words.is_some()))))
      .collect();
    assert_eq!(flat.len(), 5);
    // 修改对行应有词级数据：del 行 words 含 del 词 world；add 行含 add 词 WORLd
    let del_line = &hunks[0].lines[0];
    assert_eq!(del_line.kind, "del");
    let dw = del_line.words.as_ref().unwrap();
    assert!(dw.iter().any(|w| w.kind == "del" && w.text == "world"));
    let add_line = &hunks[0].lines[1];
    assert_eq!(add_line.kind, "add");
    let aw = add_line.words.as_ref().unwrap();
    assert!(aw.iter().any(|w| w.kind == "add" && w.text == "WORLd"));
    // line3 → line3 new：词级只有 add 行有数据（del 行匹配不上 → 降级 None，行级仍正确）
    let line3_del = &hunks[0].lines[3];
    assert_eq!(line3_del.kind, "del");
    assert_eq!(line3_del.text, "line3");
    let line3_add = &hunks[0].lines[4];
    assert_eq!(line3_add.kind, "add");
    assert_eq!(line3_add.text, "line3 new");
    assert!(line3_add.words.is_some());
    let _ = fs::remove_dir_all(&dir);
  }
}


#[tauri::command]
fn git_diff_file(
  state: State<AppState>,
  path: String,
  from: Option<String>,
  to: Option<String>,
) -> Result<GitDiffResult, String> {
  let root = git_root(&state)?;
  let mut args = vec!["diff", "--no-color", "-U3"];
  if let Some(f) = &from {
    args.push(f.as_str());
    args.push(to.as_deref().unwrap_or("HEAD"));
  } else {
    // 工作区 vs HEAD
    args.push("HEAD");
  }
  args.push("--");
  args.push(&path);
  let out = run_git(&root, &args)?;
  if !out.status.success() {
    return Err(String::from_utf8_lossy(&out.stderr).trim().into());
  }
  let exists = resolve(&root, &path).map(|p| p.exists()).unwrap_or(false);
  let text = String::from_utf8_lossy(&out.stdout);
  if text.is_empty() {
    return Ok(GitDiffResult { hunks: Vec::new(), added: 0, deleted: 0, exists });
  }
  let (hunks, added, deleted) = parse_unified_diff(&text, None);
  // 词级高亮（M11b）：--word-diff=porcelain 解析，行组与 unified 行序合并
  let mut word_hunks = hunks;
  if !word_hunks.is_empty() {
    let wout = run_git(&root, &["diff", "--word-diff=porcelain", "--no-color", "-U3"]);
    if let Ok(wout) = wout {
      if wout.status.success() {
        let wtext = String::from_utf8_lossy(&wout.stdout);
        let groups = parse_word_groups(&wtext);
        if !groups.is_empty() {
          let (wh, _, _) = parse_unified_diff(&text, Some(groups));
          word_hunks = wh;
        }
      }
    }
  }
  Ok(GitDiffResult { hunks: word_hunks, added, deleted, exists })
}

/// 取某版本的文件内容（渲染模式旧版本用）：rev = 'HEAD' / '<sha>' / '<sha>^' 等
#[tauri::command]
fn git_show_file(state: State<AppState>, path: String, rev: String) -> Result<String, String> {
  let root = git_root(&state)?;
  let out = run_git(&root, &["show", &format!("{rev}:{path}")])?;
  if !out.status.success() {
    return Err(format!("{}（该版本可能不存在此文件）", String::from_utf8_lossy(&out.stderr).trim()));
  }
  Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// 还原整文件到 HEAD（丢弃全部未提交改动）
#[tauri::command]
fn git_discard_file(state: State<AppState>, path: String) -> Result<(), String> {
  let root = git_root(&state)?;
  let out = run_git(&root, &["checkout", "--", &path])?;
  if !out.status.success() {
    return Err(String::from_utf8_lossy(&out.stderr).trim().into());
  }
  Ok(())
}

/// 从 unified diff 文本提取第 idx 个 hunk（含 diff 头部）→ 可独立应用的补丁
fn extract_hunk_patch(diff_text: &str, idx: usize) -> Option<String> {
  let lines: Vec<&str> = diff_text.lines().collect();
  let mut found = 0usize;
  let mut start = None;
  let mut header_end = 0usize; // 第一个 @@ 行（header 不含 hunk）
  for (i, l) in lines.iter().enumerate() {
    if l.starts_with("@@") {
      if header_end == 0 {
        header_end = i;
      }
      if found == idx {
        start = Some(i);
        break;
      }
      found += 1;
    }
  }
  let start = start?;
  // hunk 结束：下一个 @@ 行（或文件尾）；\ No newline 行归属当前 hunk
  let mut end = lines.len();
  for (i, l) in lines.iter().enumerate().skip(start + 1) {
    if l.starts_with("@@") {
      end = i;
      break;
    }
  }
  let mut out = String::new();
  for l in &lines[..header_end] {
    out.push_str(l);
    out.push('\n');
  }
  for l in &lines[start..end] {
    out.push_str(l);
    out.push('\n');
  }
  Some(out)
}

/// 还原单个 hunk（仅工作区 diff）：提取该 hunk 的 -U0 补丁 → git apply --reverse
#[tauri::command]
fn git_discard_hunk(
  state: State<AppState>,
  path: String,
  hunk_index: usize,
) -> Result<(), String> {
  let root = git_root(&state)?;
  // -U0 无上下文：hunk 头行号精确，可独立应用
  let out = run_git(&root, &["diff", "--no-color", "-U0", "HEAD", "--", &path])?;
  if !out.status.success() {
    return Err(String::from_utf8_lossy(&out.stderr).trim().into());
  }
  let text = String::from_utf8_lossy(&out.stdout);
  let patch = extract_hunk_patch(&text, hunk_index).ok_or("hunk 不存在或文件无改动")?;
  use std::io::Write;
  let mut child = std::process::Command::new("git")
    .args(["apply", "--reverse", "--unidiff-zero", "-"])
    .current_dir(&root)
    .stdin(std::process::Stdio::piped())
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::piped())
    .spawn()
    .map_err(|e| format!("git apply 启动失败: {e}"))?;
  child
    .stdin
    .take()
    .unwrap()
    .write_all(patch.as_bytes())
    .map_err(|e| format!("写入补丁失败: {e}"))?;
  let out = child.wait_with_output().map_err(|e| format!("git apply 失败: {e}"))?;
  if !out.status.success() {
    return Err(String::from_utf8_lossy(&out.stderr).trim().into());
  }
  Ok(())
}

/// 切换分支（未提交改动检查由前端确认）
#[tauri::command]
fn git_checkout_branch(state: State<AppState>, name: String) -> Result<(), String> {
  let root = git_root(&state)?;
  let out = run_git(&root, &["checkout", &name])?;
  if !out.status.success() {
    return Err(String::from_utf8_lossy(&out.stderr).trim().into());
  }
  Ok(())
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
      reveal_in_explorer,
      save_binary,
      git_user_name,
      git_repo_info,
      git_branches,
      git_status,
      git_log,
      git_show_commit,
      git_diff_file,
      git_show_file,
      git_discard_file,
      git_discard_hunk,
      git_checkout_branch,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

// ---------- git 用户名（批注评论）----------
// 工作目录是 git 仓库 → 返回 `git config user.name`；否则 null

#[tauri::command]
fn git_user_name(state: State<AppState>) -> Option<String> {
  let root = state.root.lock().ok()?.clone()?;
  // git 仓库检测：目录含 .git（或 git rev-parse 可用）
  let has_git = root.join(".git").exists();
  if !has_git {
    return None;
  }
  let out = std::process::Command::new("git")
    .args(["config", "user.name"])
    .current_dir(&root)
    .output()
    .ok()?;
  if out.status.success() {
    let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if !name.is_empty() {
      return Some(name);
    }
  }
  None
}
