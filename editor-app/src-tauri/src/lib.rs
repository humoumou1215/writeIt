use serde::Serialize;
use std::{
  fs,
  path::{Path, PathBuf},
  sync::Mutex,
};

use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};

mod debug_server;

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
  pub root: Mutex<Option<PathBuf>>,
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

/// 应用可执行文件所在目录（桌面启动的默认/兜底工作目录）。
/// 打包后 = 安装目录（可执行文件所在处）；开发期 = target/debug 之类。
#[tauri::command]
fn app_dir() -> String {
  std::env::current_exe()
    .ok()
    .and_then(|p| p.parent().map(|p| p.to_path_buf()))
    .map(|p| p.to_string_lossy().to_string())
    .unwrap_or_default()
}

// ---------- WebView2 启动参数（设置项 → Rust 文件 → 重启生效）----------
// 背景：additionalBrowserArgs 只能在 WebView2 进程创建时注入（见 run() 的 setup），
// 运行时改不了 → 前端设置保存到这里，重启后由 setup 读取并注入。

fn webview_args_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  Ok(dir.join("webview-args.txt"))
}

/// 读取已保存的 WebView2 启动参数（空 = 用默认组合）
#[tauri::command]
fn get_webview_args(app: tauri::AppHandle) -> String {
  webview_args_path(&app)
    .ok()
    .and_then(|p| fs::read_to_string(p).ok())
    .unwrap_or_default()
}

/// 持久化 WebView2 启动参数（等用户点「重启」后生效）
#[tauri::command]
fn save_webview_args(app: tauri::AppHandle, args: String) -> Result<(), String> {
  let p = webview_args_path(&app)?;
  fs::write(p, args.trim()).map_err(|e| e.to_string())
}

/// 重启应用（WebView2 启动参数需整进程重启才生效）
#[tauri::command]
fn restart_app(app: tauri::AppHandle) -> Result<(), String> {
  let exe = std::env::current_exe().map_err(|e| e.to_string())?;
  std::process::Command::new(&exe)
    .spawn()
    .map_err(|e| e.to_string())?;
  app.exit(0);
  Ok(())
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
    // explorer /select,<path>：打开所在目录并选中文件/文件夹。
    // 关键：路径必须统一为反斜杠 + 带引号——explorer 解析不了正斜杠（会静默回退到桌面），
    // 且含空格的路径不整体加引号也会解析失败回退桌面。
    let sel = path.display().to_string().replace('/', "\\");
    std::process::Command::new("explorer")
      .arg(format!("/select,\"{sel}\""))
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
  /// M-A-D-U-?-R-C（兼容字段 = worktree 有码则 worktree 码，否则 index 码，旧 UI 仍可用）
  pub status: String,
  /// X 码：index vs HEAD（' ' = 未暂存）
  pub index_status: String,
  /// Y 码：worktree vs index（' ' = 无工作区改动）
  pub worktree_status: String,
  /// R/C：旧路径（-z 下第二段记录）
  #[serde(skip_serializing_if = "Option::is_none")]
  pub rename_from: Option<String>,
  /// 工作区行数 = index..worktree numstat；未跟踪 = 磁盘行数
  pub added: i64,
  pub deleted: i64,
  /// staged 行数 = HEAD..index numstat
  pub index_added: i64,
  pub index_deleted: i64,
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

/// 构造子进程 Command：Windows 下附加 CREATE_NO_WINDOW，避免 git 等控制台程序每次调用闪现黑窗
#[cfg(target_os = "windows")]
fn no_console(cmd: &mut std::process::Command) -> &mut std::process::Command {
  use std::os::windows::process::CommandExt;
  cmd.creation_flags(0x0800_0000) // CREATE_NO_WINDOW
}
#[cfg(not(target_os = "windows"))]
fn no_console(cmd: &mut std::process::Command) -> &mut std::process::Command {
  cmd
}

fn run_git(root: &Path, args: &[&str]) -> Result<std::process::Output, String> {
  // M16 Phase 0 #4：-c core.quotepath=false 统一注入（中文路径不做 octal 转义）
  no_console(&mut std::process::Command::new("git"))
    .arg("-c")
    .arg("core.quotepath=false")
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
  let entries = parse_porcelain(&out.stdout);
  let mut files: Vec<GitFileStatus> = Vec::new();
  for e in entries {
    // 未跟踪目录条目（`?? 目录/`）→ 展开为内部文件
    if e.x == '?' && e.path.ends_with('/') {
      expand_untracked_dir(&root, &e.path, &mut files);
      continue;
    }
    // 兼容字段：worktree 有码则 worktree 码，否则 index 码
    let status = if e.y != ' ' { e.y.to_string() } else { e.x.to_string() };
    files.push(GitFileStatus {
      path: e.path,
      status,
      index_status: e.x.to_string(),
      worktree_status: e.y.to_string(),
      rename_from: e.rename_from,
      added: -1,
      deleted: -1,
      index_added: -1,
      index_deleted: -1,
    });
  }
  // 行数双通道（-z）：unstaged（index..worktree）+ staged（HEAD..index）
  fill_numstat(&root, &mut files, false);
  fill_numstat(&root, &mut files, true);
  // 未跟踪文件：读盘行数（正常笔记文件不大）
  for f in files.iter_mut() {
    if f.status == "?" && f.added < 0 {
      if let Ok(full) = resolve(&root, &f.path) {
        if let Ok(s) = std::fs::read_to_string(&full) {
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
    // git --format 在每条记录后追加 '\n' → 除首条外 hash 前有换行；trim 归一
    let rec = rec.trim_start_matches('\n');
    let parts: Vec<&str> = rec.split('\u{1f}').collect();
    if parts.len() < 5 || parts[0].is_empty() {
      continue;
    }
    commits.push(GitCommit {
      hash: parts[0].trim().to_string(),
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
  // 文件列表：diff-tree --name-status -z（Phase 0 #4：-z 才不会丢中文路径统计；
  //   -z 下 rename 两段路径 = old, new，key 取 new）
  let nout = run_git(&root, &["diff-tree", "--name-status", "-z", "--no-commit-id", "-r", "--root", "-M", &hash])?;
  let mut status_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
  if nout.status.success() {
    let nout_str = String::from_utf8_lossy(&nout.stdout);
    let toks: Vec<&str> = nout_str.split('\0').collect();
    let mut i = 0;
    while i < toks.len() {
      let st = toks[i];
      i += 1;
      if st.is_empty() {
        continue;
      }
      let p = toks.get(i).copied().unwrap_or("");
      i += 1;
      if p.is_empty() {
        continue;
      }
      let code = st.as_bytes()[0] as char;
      if code == 'R' || code == 'C' {
        // diff-tree -z：旧路径在前、新路径在后 → key 取第二段
        let new_path = toks.get(i).copied().unwrap_or(p);
        i += 1;
        if !new_path.is_empty() {
          status_map.insert(new_path.to_string(), if code == 'R' { "R".into() } else { "C".into() });
        }
      } else {
        let key = if code == 'A' { "A".into() } else if code == 'D' { "D".into() } else { "M".into() };
        status_map.insert(p.to_string(), key);
      }
    }
  }
  // 行数：diff-tree --numstat -z（-z：rename 两段路径，key 取 last，Phase 0 #6）
  let mout = run_git(&root, &["diff-tree", "--numstat", "-z", "--no-commit-id", "-r", "--root", "-M", &hash])?;
  let num_map: std::collections::HashMap<String, (i64, i64)> = if mout.status.success() {
    parse_numstat_z(&mout.stdout)
  } else {
    std::collections::HashMap::new()
  };
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

/// git status --porcelain=v1 -z 单记录（M16：XY 双码）
struct PorcelainEntry {
  x: char,
  y: char,
  path: String,
  rename_from: Option<String>,
}

/// 解析 git status --porcelain=v1 -z 输出 → XY 双码列表
/// 关键（Phase 0 #6 实测）：-z 下 rename/复制两记录顺序为 `XY <新路径>` NUL `<旧路径>`
///   （与 non-z 的 `old -> new` 相反）；第二段 = 旧路径 → rename_from
fn parse_porcelain(bytes: &[u8]) -> Vec<PorcelainEntry> {
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
    let x = rec.as_bytes()[0] as char;
    let y = rec.as_bytes()[1] as char;
    let path = rec[3..].to_string();
    if x == 'R' || x == 'C' {
      // -z：第一段 = 新路径，第二段 = 旧路径
      let end2 = bytes[i..]
        .iter()
        .position(|&b| b == 0)
        .map(|p| i + p)
        .unwrap_or(bytes.len());
      let old_path = String::from_utf8_lossy(&bytes[i..end2]).to_string();
      i = end2 + 1;
      files.push(PorcelainEntry { x, y, path, rename_from: Some(old_path) });
      continue;
    }
    files.push(PorcelainEntry { x, y, path, rename_from: None });
  }
  files
}

/// git diff --numstat -z 输出 → path → (add, del)
/// 普通记录：`add\tdel\tpath`（统计与路径同一 NUL token）
/// rename 记录：`add\tdel\t` NUL `old` NUL `new`（路径独立 token，key 取最后一段，Phase 0 #6）
fn parse_numstat_z(bytes: &[u8]) -> std::collections::HashMap<String, (i64, i64)> {
  let text = String::from_utf8_lossy(bytes);
  let toks: Vec<&str> = text.split('\0').collect();
  let mut map = std::collections::HashMap::new();
  let mut i = 0;
  while i < toks.len() {
    let t = toks[i];
    // 形如 `A\tD` / `A\tD\t`（rename）/ `A\tD\tpath`（普通）
    let mut it = t.splitn(3, '\t');
    let a = it.next().unwrap_or("");
    let d = it.next().unwrap_or("");
    let rest = it.next().unwrap_or("");
    let (Ok(ac), Ok(dc)) = (a.trim().parse::<i64>(), d.trim().parse::<i64>()) else {
      i += 1;
      continue;
    };
    i += 1;
    if !rest.is_empty() {
      map.insert(rest.to_string(), (ac, dc));
      continue;
    }
    // rename：统计 token 以 tab 结尾，路径在后续 NUL token（old, new → key 取 new）
    let mut paths: Vec<&str> = Vec::new();
    while i < toks.len() {
      let nx = toks[i];
      let mut it2 = nx.splitn(3, '\t');
      let a2 = it2.next().unwrap_or("");
      let d2 = it2.next().unwrap_or("");
      if a2.trim().parse::<i64>().is_ok() && d2.trim().parse::<i64>().is_ok() {
        break;
      }
      if !nx.is_empty() {
        paths.push(nx);
      }
      i += 1;
    }
    if let Some(np) = paths.last() {
      map.insert(np.to_string(), (ac, dc));
    }
  }
  map
}

/// 行数回填：unstaged（git diff --numstat -z）或 staged（git diff --cached --numstat -z）
fn fill_numstat(root: &Path, files: &mut [GitFileStatus], cached: bool) {
  let args: &[&str] = if cached {
    &["diff", "--cached", "--numstat", "-z"]
  } else {
    &["diff", "--numstat", "-z"]
  };
  if let Ok(out) = run_git(root, args) {
    if out.status.success() {
      let map = parse_numstat_z(&out.stdout);
      for f in files.iter_mut() {
        if let Some(&(a, d)) = map.get(&f.path) {
          if cached {
            f.index_added = a;
            f.index_deleted = d;
          } else {
            f.added = a;
            f.deleted = d;
          }
        }
      }
    }
  }
}

/// 未跟踪目录条目（`?? 目录/`）→ 递归展开为内部文件（含行数）
fn expand_untracked_dir(root: &Path, dir_rel: &str, files: &mut Vec<GitFileStatus>) {
  let base = dir_rel.trim_end_matches('/');
  let Ok(full) = resolve(root, base) else {
    return;
  };
  let mut out: Vec<(String, i64)> = Vec::new();
  collect_untracked(&full, base, &mut out);
  for (fp, lines) in out {
    files.push(GitFileStatus {
      path: fp,
      status: "?".into(),
      index_status: "?".into(),
      worktree_status: "?".into(),
      rename_from: None,
      added: lines,
      deleted: 0,
      index_added: -1,
      index_deleted: -1,
    });
  }
}

fn collect_untracked(dir: &std::path::Path, rel: &str, out: &mut Vec<(String, i64)>) {
  if let Ok(rd) = std::fs::read_dir(dir) {
    for e in rd.flatten() {
      let name = e.file_name().to_string_lossy().to_string();
      if name == ".git" {
        continue;
      }
      let r = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
      if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
        collect_untracked(&e.path(), &r, out);
      } else {
        let lines = std::fs::read_to_string(&e.path()).map(|s| s.lines().count() as i64).unwrap_or(-1);
        out.push((r, lines));
      }
    }
  }
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
    // XY 双码
    assert_eq!((files[0].x, files[0].y), (' ', 'M'));
    assert_eq!(files[0].path, "a.md");
    assert_eq!((files[1].x, files[1].y), ('A', ' '));
    assert_eq!(files[1].path, "b.md");
    assert_eq!((files[2].x, files[2].y), ('?', '?'));
    assert_eq!(files[2].path, "c.md");
    assert_eq!((files[3].x, files[3].y), ('D', ' '));
    assert_eq!(files[3].path, "old.md");
    // rename_from 只有 R/C 才有
    assert!(files.iter().all(|f| f.rename_from.is_none()));
  }

  #[test]
  fn porcelain_rename_z_order() {
    // Phase 0 #6：-z 下第一段 = 新路径，第二段 = 旧路径（与 non-z 相反）
    let bytes = b"R  new.md\0old.md\0";
    let files = parse_porcelain(bytes);
    assert_eq!(files.len(), 1);
    let f = &files[0];
    assert_eq!(f.x, 'R');
    assert_eq!(f.path, "new.md");
    assert_eq!(f.rename_from.as_deref(), Some("old.md"));
  }

  #[test]
  fn numstat_z_parse() {
    // 普通：`1\t0\tpath`（同一 NUL token）；rename：`0\t0\t` NUL old NUL new（key 取最后一段）
    let bytes = b"1\t0\ta.md\02\t3\tb.md\00\t0\t\0old.md\tnew.md\0";
    let map = parse_numstat_z(bytes);
    assert_eq!(map.get("a.md"), Some(&(1, 0)));
    assert_eq!(map.get("b.md"), Some(&(2, 3)));
    assert_eq!(map.get("new.md"), Some(&(0, 0)));
    assert!(map.get("old.md").is_none(), "rename key 取新路径");
  }

  #[test]
  fn porcelain_chinese_paths() {
    // 中文路径（-z 下原样输出，不转义）
    let bytes = " M 中文.md\0".as_bytes();
    let files = parse_porcelain(bytes);
    assert_eq!(files[0].path, "中文.md");
    assert_eq!(files[0].y, 'M');
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

  /// 真实 git：-U3 diff → 提取单 hunk → git apply --reverse → 验证该 hunk 已还原
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
    // 两处改动（两个 hunk）；Phase 0 #1：-U3 提取（对齐前端 DiffView 的 hunk 序）
    fs::write(dir.join("x.md"), "line1 CHANGED\nline2\nline3\nline4 CHANGED\nline5\n").unwrap();
    let diff = run(&["diff", "--no-color", "-U3", "--", "x.md"]);
    let patch0 = extract_hunk_patch(&diff, 0).unwrap();
    let patch1 = extract_hunk_patch(&diff, 1).unwrap();
    // 反向应用 hunk0 → 第一处改动还原，第二处保留
    let apply = |patch: &str| {
      let mut child = Command::new("git")
        .args(["apply", "--reverse", "-"])
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


/// 文件是否被 git 跟踪（index/HEAD 含该路径）
fn git_tracked(root: &Path, path: &str) -> bool {
  run_git(root, &["ls-files", "--error-unmatch", "--", path])
    .map(|o| o.status.success())
    .unwrap_or(false)
}

/// git diff --no-index（差异时退出码 1 属正常；stdout 才是 diff 内容）
fn run_git_noindex(root: &Path, a: &str, b: &str) -> Result<Vec<u8>, String> {
  use std::process::Command;
  let out = no_console(&mut Command::new("git"))
    .args(["-c", "core.quotepath=false", "diff", "--no-index", "--no-color", "-U3", a, b])
    .current_dir(root)
    .output()
    .map_err(|e| format!("git diff --no-index 执行失败: {e}"))?;
  if !out.status.success() && out.status.code() != Some(1) {
    return Err(String::from_utf8_lossy(&out.stderr).trim().into());
  }
  Ok(out.stdout)
}

/// M16：diff 基准随分区变化（unstaged=index..worktree / staged=--cached / worktree=HEAD..worktree / range=a..b）
#[tauri::command]
fn git_diff_file(
  state: State<AppState>,
  path: String,
  kind: String,
  from: Option<String>,
  to: Option<String>,
) -> Result<GitDiffResult, String> {
  let root = git_root(&state)?;
  let untracked = match kind.as_str() {
    "staged" => false,
    _ => !git_tracked(&root, &path),
  };
  // rev 参数按 kind 组装
  let mut rev: Vec<String> = Vec::new();
  match kind.as_str() {
    "unstaged" => { /* index..worktree：无额外 rev */ }
    "staged" => rev.push("--cached".into()),
    "worktree" => rev.push("HEAD".into()),
    "range" => {
      rev.push(from.unwrap_or_default());
      rev.push(to.unwrap_or_else(|| "HEAD".into()));
    }
    _ => return Err(format!("未知 diff kind: {kind}")),
  }
  let mut text: String;
  if untracked {
    // 未跟踪新文件：--no-index /dev/null 合成「全新增」diff（Phase 0 #3）
    let full = resolve(&root, &path)?;
    let out = run_git_noindex(&root, "/dev/null", &full.to_string_lossy())?;
    text = String::from_utf8_lossy(&out).to_string();
  } else {
    let mut cmd = vec!["diff".to_string(), "--no-color".to_string(), "-U3".to_string()];
    cmd.extend(rev.iter().cloned());
    cmd.push("--".into());
    cmd.push(path.clone());
    let arg_refs: Vec<&str> = cmd.iter().map(|s| s.as_str()).collect();
    let out = run_git(&root, &arg_refs)?;
    if !out.status.success() {
      return Err(String::from_utf8_lossy(&out.stderr).trim().into());
    }
    text = String::from_utf8_lossy(&out.stdout).to_string();
  }
  let exists = resolve(&root, &path).map(|p| p.exists()).unwrap_or(false);
  if text.is_empty() {
    return Ok(GitDiffResult { hunks: Vec::new(), added: 0, deleted: 0, exists });
  }
  let (hunks, added, deleted) = parse_unified_diff(&text, None);
  // 词级（M11b）：同样的 rev 参数 + -- path（Phase 0 #2：不能跑全仓 diff）
  let mut word_hunks = hunks;
  if !word_hunks.is_empty() && !untracked {
    let mut wcmd = vec!["diff".to_string(), "--word-diff=porcelain".to_string(), "--no-color".to_string(), "-U3".to_string()];
    wcmd.extend(rev.iter().cloned());
    wcmd.push("--".into());
    wcmd.push(path.clone());
    let warg_refs: Vec<&str> = wcmd.iter().map(|s| s.as_str()).collect();
    if let Ok(wout) = run_git(&root, &warg_refs) {
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

/// M18 §4.7：批量取多文件旧/新内容 + hunks 标志 + 内容 hash（嵌入源扫描一次往返）。
/// kind 同 git_diff_file（unstaged/staged/worktree/range）；候选路径一次 ls-files 解析。
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShowFileEntry {
  #[serde(rename = "write")]
  write: String,
  real_path: String,
  old: Option<String>,
  next: Option<String>,
  exists: bool,
  changed: Option<bool>,
  hash: Option<ShowFileHash>,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShowFileHash {
  old: String,
  next: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShowFilesResult {
  entries: Vec<ShowFileEntry>,
}

/// FNV-1a 32 位内容指纹（与前端 src/git/hash.ts / vite-plugins/dev-repo.ts 同算法）
fn content_hash(content: &str) -> String {
  let mut h: u32 = 0x811c9dc5;
  for b in content.as_bytes() {
    h ^= *b as u32;
    h = h.wrapping_mul(0x0100_0193);
  }
  format!("{:08x}", h)
}

fn show_file_content(root: &Path, path: &str, rev: &str) -> Result<String, String> {
  let arg = if rev.is_empty() {
    format!(":{path}") // index blob
  } else {
    format!("{rev}:{path}")
  };
  let out = run_git(&root, &["show", &arg])?;
  if !out.status.success() {
    return Err(String::from_utf8_lossy(&out.stderr).trim().into());
  }
  Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

#[tauri::command]
fn git_show_files(
  state: State<AppState>,
  paths: Vec<String>,
  kind: String,
  from: Option<String>,
  to: Option<String>,
) -> Result<ShowFilesResult, String> {
  let root = git_root(&state)?;
  // rev 组装（对齐前端 DiffBase 语义）：
  //   unstaged / worktree：旧 = HEAD；新 = index（''）；
  //   staged：旧 = HEAD；新 = index（''）；
  //   range：旧 = from；新 = to
  let old_rev = if kind == "range" {
    from.unwrap_or_else(|| "HEAD".into())
  } else {
    "HEAD".into()
  };
  let new_rev = if kind == "range" {
    to.unwrap_or_else(|| "HEAD".into())
  } else {
    String::new() // index
  };

  let mut entries: Vec<ShowFileEntry> = Vec::new();
  for req in &paths {
    // 候选路径一次 ls-files 解析（仅跟踪文件）；未跟踪文件（新嵌入源）补磁盘存在性探测
    let mut real: Option<String> = None;
    let candidates: Vec<String> = vec![
      req.clone(),
      format!("{req}.md"),
      format!("{req}.markdown"),
      format!("{req}.txt"),
    ];
    let cand_refs: Vec<&str> = candidates.iter().map(|s| s.as_str()).collect();
    let mut args = vec!["ls-files", "--"];
    args.extend(cand_refs.iter().copied());
    if let Ok(out) = run_git(&root, &args) {
      if out.status.success() {
        let list = String::from_utf8_lossy(&out.stdout);
        real = list.lines().next().map(|s| s.to_string());
      }
    }
    if real.is_none() {
      for c in &candidates {
        if resolve(&root, c).map(|p| p.exists()).unwrap_or(false) {
          real = Some(c.clone());
          break;
        }
      }
    }
    let real = match real {
      Some(r) => r,
      None => {
        entries.push(ShowFileEntry {
          write: req.clone(),
          real_path: req.clone(),
          old: None,
          next: None,
          exists: false,
          changed: None,
          hash: None,
        });
        continue;
      }
    };
    // 每请求产一个 entry（writePath→realPath 映射完整；相同 realPath 由消费者去重）
    let mut old: Option<String> = None;
    let mut next: Option<String> = None;
    let mut exists = false;
    let mut changed: Option<bool> = None;
    let mut hash: Option<ShowFileHash> = None;
    if resolve(&root, &real).map(|p| p.exists()).unwrap_or(false) || git_tracked(&root, &real) {
      old = show_file_content(&root, &real, &old_rev).ok();
      next = show_file_content(&root, &real, &new_rev).ok();
    }
    exists = resolve(&root, &real).map(|p| p.exists()).unwrap_or(false) || git_tracked(&root, &real);
    changed = match (&old, &next) {
      (Some(o), Some(n)) => Some(o != n),
      (None, Some(_)) => Some(true), // 新文件
      _ => None,
    };
    hash = match (&old, &next) {
      (Some(o), Some(n)) => Some(ShowFileHash {
        old: content_hash(o),
        next: content_hash(n),
      }),
      (Some(o), None) => Some(ShowFileHash {
        old: content_hash(o),
        next: content_hash(""),
      }),
      (None, Some(n)) => Some(ShowFileHash {
        old: content_hash(""),
        next: content_hash(n),
      }),
      (None, None) => None,
    };
    entries.push(ShowFileEntry {
      write: req.clone(),
      real_path: real,
      old,
      next,
      exists,
      changed,
      hash,
    });
  }
  Ok(ShowFilesResult { entries })
}

/// 还原整文件（M16：未跟踪 → 删文件；其他 → checkout --，即 index → worktree，Phase 0 #5）
#[tauri::command]
fn git_discard_file(state: State<AppState>, path: String) -> Result<(), String> {
  let root = git_root(&state)?;
  if !git_tracked(&root, &path) {
    let full = resolve(&root, &path)?;
    if full.is_dir() {
      std::fs::remove_dir_all(&full).map_err(|e| e.to_string())?;
    } else if full.exists() {
      std::fs::remove_file(&full).map_err(|e| e.to_string())?;
    }
    return Ok(());
  }
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

/// 还原单个 hunk（仅 Changes 区，index..worktree 层）：
/// -U3 提取（与前端 DiffView 的 hunk 序号一致，Phase 0 #1）→ git apply --reverse
#[tauri::command]
fn git_discard_hunk(
  state: State<AppState>,
  path: String,
  hunk_index: usize,
) -> Result<(), String> {
  let root = git_root(&state)?;
  let out = run_git(&root, &["diff", "--no-color", "-U3", "--", &path])?;
  if !out.status.success() {
    return Err(String::from_utf8_lossy(&out.stderr).trim().into());
  }
  let text = String::from_utf8_lossy(&out.stdout);
  let patch = extract_hunk_patch(&text, hunk_index).ok_or("hunk 不存在或文件无改动")?;
  use std::io::Write;
  let mut child = no_console(&mut std::process::Command::new("git"))
    .args(["apply", "--reverse", "-"])
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

// ---------- M16 SCM：暂存/提交/同步/分支 ----------

fn run_git_checked(root: &Path, args: &[&str]) -> Result<(), String> {
  let out = run_git(root, args)?;
  if !out.status.success() {
    return Err(String::from_utf8_lossy(&out.stderr).trim().into());
  }
  Ok(())
}

#[tauri::command]
fn git_stage(state: State<AppState>, paths: Vec<String>) -> Result<(), String> {
  if paths.is_empty() {
    return Ok(());
  }
  let root = git_root(&state)?;
  let mut args = vec!["add", "-A", "--"];
  for p in &paths {
    args.push(p.as_str());
  }
  run_git_checked(&root, &args)
}

/// 取消暂存：git reset -q HEAD -- paths（实测无 HEAD 的首次提交仓库同样可用）
#[tauri::command]
fn git_unstage(state: State<AppState>, paths: Vec<String>) -> Result<(), String> {
  if paths.is_empty() {
    return Ok(());
  }
  let root = git_root(&state)?;
  let mut args = vec!["reset", "-q", "HEAD", "--"];
  for p in &paths {
    args.push(p.as_str());
  }
  run_git_checked(&root, &args)
}

/// staged 区「还原到 HEAD」：index ← HEAD 且 worktree ← HEAD（破坏性，前端 danger confirm）
#[tauri::command]
fn git_revert_to_head(state: State<AppState>, paths: Vec<String>) -> Result<(), String> {
  if paths.is_empty() {
    return Ok(());
  }
  let root = git_root(&state)?;
  {
    let mut args = vec!["reset", "-q", "HEAD", "--"];
    for p in &paths {
      args.push(p.as_str());
    }
    run_git_checked(&root, &args)?;
  }
  {
    let mut args = vec!["checkout", "--"];
    for p in &paths {
      args.push(p.as_str());
    }
    run_git_checked(&root, &args)?;
  }
  Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CommitResult {
  hash: String,
}

/// 提交：commit -m msg（+--amend）；stage_all → 先 git add -A。返回 HEAD hash
#[tauri::command]
fn git_commit(
  state: State<AppState>,
  message: String,
  amend: bool,
  stage_all: bool,
) -> Result<CommitResult, String> {
  let root = git_root(&state)?;
  if stage_all {
    run_git_checked(&root, &["add", "-A"])?;
  }
  let mut args = vec!["commit"];
  if amend {
    args.push("--amend");
  }
  args.extend(["-m", message.as_str()]);
  run_git_checked(&root, &args)?;
  let hout = run_git(&root, &["rev-parse", "HEAD"])?;
  let hash = String::from_utf8_lossy(&hout.stdout).trim().to_string();
  Ok(CommitResult { hash })
}

#[tauri::command]
fn git_fetch(state: State<AppState>) -> Result<(), String> {
  let root = git_root(&state)?;
  run_git_checked(&root, &["fetch"])
}

#[tauri::command]
fn git_pull(state: State<AppState>) -> Result<(), String> {
  let root = git_root(&state)?;
  run_git_checked(&root, &["pull", "--no-rebase"])
}

/// 推送：普通 push；首次无 upstream（报错含 upstream）→ git push -u origin <branch>
#[tauri::command]
fn git_push(state: State<AppState>) -> Result<(), String> {
  let root = git_root(&state)?;
  match run_git_checked(&root, &["push"]) {
    Ok(()) => Ok(()),
    Err(e) => {
      if e.contains("upstream") || e.contains("fetch first") {
        let branch = run_git(&root, &["branch", "--show-current"])
          .ok()
          .filter(|o| o.status.success())
          .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
          .filter(|s| !s.is_empty());
        if let Some(b) = branch {
          return run_git_checked(&root, &["push", "-u", "origin", b.as_str()]);
        }
      }
      Err(e)
    }
  }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AheadBehind {
  ahead: i64,
  behind: i64,
}

/// ahead/behind（本地计算，无网络）：无 upstream → null（UI 隐藏 sync）
#[tauri::command]
fn git_ahead_behind(state: State<AppState>) -> Result<Option<AheadBehind>, String> {
  let root = git_root(&state)?;
  let has_upstream = run_git(&root, &["rev-parse", "--abbrev-ref", "@{upstream}"])
    .map(|o| o.status.success())
    .unwrap_or(false);
  if !has_upstream {
    return Ok(None);
  }
  let out = run_git(&root, &["rev-list", "--left-right", "--count", "@{upstream}...HEAD"])?;
  if !out.status.success() {
    return Ok(None);
  }
  let text = String::from_utf8_lossy(&out.stdout);
  let mut parts = text.split_whitespace();
  let behind: i64 = parts.next().and_then(|s| s.trim().parse().ok()).unwrap_or(0);
  let ahead: i64 = parts.next().and_then(|s| s.trim().parse().ok()).unwrap_or(0);
  Ok(Some(AheadBehind { ahead, behind }))
}

#[tauri::command]
fn git_create_branch(state: State<AppState>, name: String, from: Option<String>) -> Result<(), String> {
  let root = git_root(&state)?;
  let mut args = vec!["branch"];
  args.push(name.as_str());
  if let Some(f) = &from {
    args.push(f.as_str());
  }
  run_git_checked(&root, &args)
}

#[tauri::command]
fn git_rename_branch(state: State<AppState>, from: String, to: String) -> Result<(), String> {
  let root = git_root(&state)?;
  run_git_checked(&root, &["branch", "-m", from.as_str(), to.as_str()])
}

#[tauri::command]
fn git_delete_branch(state: State<AppState>, name: String) -> Result<(), String> {
  let root = git_root(&state)?;
  run_git_checked(&root, &["branch", "-D", name.as_str()])
}

/// 追加一条规则到仓库根 .gitignore（无则创建）
#[tauri::command]
fn git_ignore(state: State<AppState>, path: String) -> Result<(), String> {
  let root = git_root(&state)?;
  let gi = root.join(".gitignore");
  let mut content = String::new();
  if let Ok(s) = std::fs::read_to_string(&gi) {
    content = s;
    if !content.ends_with('\n') {
      content.push('\n');
    }
  }
  content.push('/');
  content.push_str(&path);
  content.push('\n');
  std::fs::write(&gi, content).map_err(|e| e.to_string())
}

// ---------- 注册 ----------

/// 诊断信息（D3）：系统/应用信息，供前端诊断包环境层使用
#[tauri::command]
fn diagnostics_info() -> serde_json::Value {
  serde_json::json!({
    "os": std::env::consts::OS,
    "arch": std::env::consts::ARCH,
    "family": std::env::consts::FAMILY,
    "appVersion": env!("CARGO_PKG_VERSION"),
    "locale": std::env::var("LANG")
        .ok()
        .or_else(|| std::env::var("LC_ALL").ok())
        .or_else(|| std::env::var("USERPROFILE").ok())
        .unwrap_or_default(),
    "exeDir": std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default(),
  })
}

/// 应用数据目录：panic 日志落盘位置（各平台约定）
fn app_data_dir() -> std::path::PathBuf {
  #[cfg(target_os = "windows")]
  {
    let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
    std::path::PathBuf::from(base).join("com.writeit.app")
  }
  #[cfg(target_os = "macos")]
  {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    std::path::PathBuf::from(home)
      .join("Library/Application Support/com.writeit.app")
  }
  #[cfg(target_os = "linux")]
  {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    std::path::PathBuf::from(home).join(".local/share/com.writeit.app")
  }
  #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
  {
    std::path::PathBuf::from(".")
  }
}

/// 崩溃取证（D3）：Rust panic → 追加写 writeit-panic.log（用户反馈「闪退」时唯一证据）
/// 链式接管 tauri 默认 hook：先落盘，再保留原有行为。
pub fn install_panic_hook() {
  let prev = std::panic::take_hook();
  std::panic::set_hook(Box::new(move |info| {
    let dir = app_data_dir();
    let _ = std::fs::create_dir_all(&dir);
    let line = format!(
      "{} PANIC: {}\n",
      chrono_now(),
      info.payload().downcast_ref::<&str>().map(|s| s.to_string())
          .or_else(|| info.payload().downcast_ref::<String>().cloned())
          .unwrap_or_else(|| "<无 payload>".into())
    );
    let loc = info
      .location()
      .map(|l| format!("  at {}:{}:{}\n", l.file(), l.line(), l.column()))
      .unwrap_or_default();
    let _ = std::fs::OpenOptions::new()
      .create(true)
      .append(true)
      .open(dir.join("writeit-panic.log"))
      .and_then(|mut f| {
        use std::io::Write;
        f.write_all(format!("{}{}\n", line, loc).as_bytes())
      });
    prev(info);
  }));
}

/// 简易本地时间（YYYY-MM-DD HH:MM:SS，UTC 本地换算不做时区库）
fn chrono_now() -> String {
  use std::time::{SystemTime, UNIX_EPOCH};
  let secs = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_secs())
    .unwrap_or(0);
  let days = secs / 86400;
  let rem = secs % 86400;
  // 1970-01-01 起的天数 → 年月日（蔡勒式推进；精度足够，误差 ±1 日边界忽略）
  let (y, m, d) = civil_from_days(days as i64);
  format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}", y, m, d, rem / 3600, (rem % 3600) / 60, rem % 60)
}

/// days since 1970-01-01 → (year, month, day)
fn civil_from_days(z: i64) -> (i64, u32, u32) {
  let z = z + 719468;
  let era = (if z >= 0 { z } else { z - 146096 }) / 146097;
  let doe = z - era * 146097;
  let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  let y = yoe + era * 400;
  let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  let mp = (5 * doy + 2) / 153;
  let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
  let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
  (if m <= 2 { y + 1 } else { y }, m, d)
}

pub fn run() {
  // 崩溃取证：最早安装，捕获一切 panic（含 Tauri 运行时错误）
  install_panic_hook();
  tauri::Builder::default()
    .manage(AppState::default())
    .manage(debug_server::DebugServerState::default())
    .plugin(tauri_plugin_dialog::init())
    // 窗口改为启动时动态创建：读取用户保存的 WebView2 启动参数（webview-args.txt）
    // 注入 —— 该参数只能在 WebView2 进程创建时生效，故「设置项 + 保存并重启」
    .setup(|app| {
      let saved = app
        .path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("webview-args.txt"))
        .and_then(|p| fs::read_to_string(p).ok())
        .unwrap_or_default();
      let mut b = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("WriteIt")
        .inner_size(1280.0, 800.0)
        .min_inner_size(900.0, 600.0)
        .resizable(true)
        .decorations(false);
      #[cfg(target_os = "windows")]
      {
        let saved = saved.trim();
        let args = if saved.is_empty() {
          // 默认（同历史打包）：软渲染环境省 CPU 组合
          "--disable-features=CalculateNativeWinOcclusion --ignore-gpu-blocklist"
        } else {
          saved
        };
        b = b.additional_browser_args(args);
      }
      b.build()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, format!("窗口创建失败: {e}")))?;
      // 调试通道：环境变量 WRITEIT_DEBUG=local/lan 时启动即开（配合设置页开关）
      if let Ok(v) = std::env::var("WRITEIT_DEBUG") {
        if v == "local" || v == "lan" {
          let state = app.state::<debug_server::DebugServerState>();
          let _ = debug_server::start_server(app, &state, &v);
        }
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      set_root,
      app_dir,
      read_tree,
      read_file,
      write_file,
      create_file,
      create_dir,
      rename,
      remove,
      reveal_in_explorer,
      save_binary,
      diagnostics_info,
      get_webview_args,
      save_webview_args,
      restart_app,
      git_user_name,
      git_repo_info,
      git_branches,
      git_status,
      git_log,
      git_show_commit,
      git_diff_file,
      git_show_file,
      git_show_files,
      git_discard_file,
      git_discard_hunk,
      git_checkout_branch,
      git_stage,
      git_unstage,
      git_commit,
      git_revert_to_head,
      git_fetch,
      git_pull,
      git_push,
      git_ahead_behind,
      git_create_branch,
      git_rename_branch,
      git_delete_branch,
      git_ignore,
      debug_server::debug_reply,
      debug_server::debug_emit,
      debug_server::debug_server_control,
      debug_server::debug_server_status,
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
  let out = no_console(&mut std::process::Command::new("git"))
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
