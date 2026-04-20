use git2::{Repository, Sort, Time, Delta};
use serde::{Deserialize, Serialize};
use std::process::Command;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use chrono::{DateTime, Utc};
use tauri::async_runtime::spawn_blocking;

// ============= Data Structures =============

#[derive(Debug, Serialize, Deserialize)]
pub struct RepoInfo {
    pub is_repo: bool,
    pub workdir: String,
    pub current_branch: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RepoStatus {
    pub current_branch: String,
    pub staged_files: Vec<FileInfo>,
    pub modified_files: Vec<FileInfo>,
    pub untracked_files: Vec<FileInfo>,
    pub clean: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub author_name: String,
    pub author_email: String,
    pub date: String,
    pub relative_date: String,
    pub files_count: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileChange {
    pub path: String,
    pub change_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
}

// ============= Helper Functions =============

fn format_time(time: &Time) -> String {
    let secs = time.seconds();
    DateTime::from_timestamp(secs, 0)
        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
        .unwrap_or_else(|| "1970-01-01 00:00:00".to_string())
}

fn format_relative_time(time: &Time) -> String {
    let now = Utc::now().timestamp();
    let then = time.seconds();
    let diff = now - then;

    if diff < 60 {
        "刚刚".to_string()
    } else if diff < 3600 {
        format!("{}分钟前", diff / 60)
    } else if diff < 86400 {
        format!("{}小时前", diff / 3600)
    } else if diff < 604800 {
        format!("{}天前", diff / 86400)
    } else {
        DateTime::from_timestamp(then, 0)
            .map(|dt| dt.format("%m月%d日").to_string())
            .unwrap_or_else(|| "很久以前".to_string())
    }
}

fn make_file_info(path: &str, status: &str) -> FileInfo {
    let name = std::path::Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());
    FileInfo {
        path: path.to_string(),
        name,
        status: status.to_string(),
    }
}

// ============= Commands =============

#[tauri::command]
pub async fn get_repo_info(path: String) -> Result<RepoInfo, String> {
    let path_clone = path.clone();
    spawn_blocking(move || {
        get_repo_info_sync(path_clone)
    }).await.map_err(|e| e.to_string())?
}

fn get_repo_info_sync(path: String) -> Result<RepoInfo, String> {
    match Repository::discover(&path) {
        Ok(repo) => {
            let workdir = repo
                .workdir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| path.clone());
            let current_branch = repo.head().ok().and_then(|h| {
                h.shorthand().map(|s| s.to_string())
            });
            Ok(RepoInfo {
                is_repo: true,
                workdir,
                current_branch,
            })
        }
        Err(_) => {
            Ok(RepoInfo {
                is_repo: false,
                workdir: path,
                current_branch: None,
            })
        }
    }
}

#[tauri::command]
pub fn init_repository(path: String) -> Result<(), String> {
    Repository::init(&path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_repository_status(path: String) -> Result<RepoStatus, String> {
    let path_clone = path.clone();
    spawn_blocking(move || {
        get_repository_status_sync(path_clone)
    }).await.map_err(|e| e.to_string())?
}

// Keep the sync version for spawn_blocking
fn get_repository_status_sync(path: String) -> Result<RepoStatus, String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let workdir = repo.workdir().ok_or("Not a workdir")?.to_string_lossy().to_string();

    let head = repo.head().ok();
    let current_branch = head
        .as_ref()
        .and_then(|h| h.shorthand().map(|s| s.to_string()))
        .unwrap_or_else(|| "HEAD".to_string());

    let mut staged_files = Vec::new();
    let mut modified_files = Vec::new();
    let mut untracked_files = Vec::new();

    // Use git status --porcelain for tracked files (fast)
    // Use -c core.quotePath=false to prevent escaping non-ASCII characters
    let output = Command::new("git")
        .creation_flags(0x08000000)
        .args(["-c", "core.quotePath=false", "status", "--porcelain", "-uno"])
        .current_dir(&workdir)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if line.len() < 3 {
                continue;
            }
            let index_status = line.chars().next().unwrap_or(' ');
            let worktree_status = line.chars().nth(1).unwrap_or(' ');
            let file_path = line[3..].trim();
            let relative_path = file_path.replace('\\', "/");

            // Staged files - preserve the original change type
            if index_status == 'M' {
                staged_files.push(make_file_info(&relative_path, "staged_modified"));
            } else if index_status == 'D' {
                staged_files.push(make_file_info(&relative_path, "staged_deleted"));
            } else if index_status == 'A' {
                staged_files.push(make_file_info(&relative_path, "staged_added"));
            } else if index_status == 'R' {
                staged_files.push(make_file_info(&relative_path, "staged_renamed"));
            }

            // Worktree modified files
            if worktree_status == 'M' {
                modified_files.push(make_file_info(&relative_path, "modified"));
            } else if worktree_status == 'D' {
                modified_files.push(make_file_info(&relative_path, "deleted"));
            }
        }
    }

    // Get untracked files using ls-files (faster than git status -uall)
    // Use -c core.quotePath=false to prevent escaping non-ASCII characters
    let untracked_output = Command::new("git")
        .creation_flags(0x08000000)
        .args(["-c", "core.quotePath=false", "ls-files", "--others", "--exclude-standard"])
        .current_dir(&workdir)
        .output()
        .map_err(|e| e.to_string())?;

    if untracked_output.status.success() {
        let stdout = String::from_utf8_lossy(&untracked_output.stdout);
        for line in stdout.lines() {
            let file_path = line.trim();
            if !file_path.is_empty() {
                untracked_files.push(make_file_info(file_path, "untracked"));
            }
        }
    }

    let clean = staged_files.is_empty() && modified_files.is_empty() && untracked_files.is_empty();

    Ok(RepoStatus {
        current_branch,
        staged_files,
        modified_files,
        untracked_files,
        clean,
    })
}

#[tauri::command]
pub async fn stage_files(path: String, files: Vec<String>) -> Result<(), String> {
    let path_clone = path.clone();
    let files_clone = files.clone();
    spawn_blocking(move || {
        stage_files_sync(path_clone, files_clone)
    }).await.map_err(|e| e.to_string())?
}

fn stage_files_sync(path: String, files: Vec<String>) -> Result<(), String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let workdir = repo.workdir().ok_or("Not a workdir")?.to_string_lossy().to_string();

    // Use git add for staging
    for file in &files {
        let output = Command::new("git")
            .creation_flags(0x08000000)
            .args(["add", file])
            .current_dir(&workdir)
            .output()
            .map_err(|e| format!("failed to spawn git: {}", e))?;

        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git add failed: {}", err));
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn unstage_files(path: String, files: Vec<String>) -> Result<(), String> {
    let path_clone = path.clone();
    let files_clone = files.clone();
    spawn_blocking(move || {
        unstage_files_sync(path_clone, files_clone)
    }).await.map_err(|e| e.to_string())?
}

fn unstage_files_sync(path: String, files: Vec<String>) -> Result<(), String> {
    for file in &files {
        let output = Command::new("git")
            .creation_flags(0x08000000)
            .args(["reset", "HEAD", "--", file])
            .current_dir(&path)
            .output()
            .map_err(|e| format!("failed to spawn git: {}", e))?;

        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            return Err(format!("git reset failed: {}", err));
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn stage_all(path: String) -> Result<(), String> {
    let path_clone = path.clone();
    spawn_blocking(move || {
        stage_all_sync(path_clone)
    }).await.map_err(|e| e.to_string())?
}

fn stage_all_sync(path: String) -> Result<(), String> {
    let output = Command::new("git")
        .creation_flags(0x08000000)
        .args(["add", "-A"])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("failed to spawn git: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git add -A failed: {}", err));
    }
    Ok(())
}

#[tauri::command]
pub async fn unstage_all(path: String) -> Result<(), String> {
    let path_clone = path.clone();
    spawn_blocking(move || {
        unstage_all_sync(path_clone)
    }).await.map_err(|e| e.to_string())?
}

fn unstage_all_sync(path: String) -> Result<(), String> {
    // Discover the actual workdir (find .git directory)
    let workdir = match Repository::discover(&path) {
        Ok(repo) => repo.workdir().map(|p| p.to_path_buf()),
        Err(_) => None,
    };

    let workdir_path = workdir.as_ref().map(|p| p.as_path()).unwrap_or(std::path::Path::new(&path));

    // Use git reset which is much faster than manipulating index directly
    let output = Command::new("git")
        .creation_flags(0x08000000)
        .args(["reset", "HEAD", "--"])
        .current_dir(workdir_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn commit_files(
    path: String,
    message: String,
    #[allow(non_snake_case)]
    authorName: String,
    #[allow(non_snake_case)]
    authorEmail: String,
) -> Result<String, String> {
    let path_clone = path.clone();
    let message_clone = message.clone();
    let author_name_clone = authorName.clone();
    let author_email_clone = authorEmail.clone();
    spawn_blocking(move || {
        commit_files_sync(path_clone, message_clone, author_name_clone, author_email_clone)
    }).await.map_err(|e| e.to_string())?
}

fn commit_files_sync(
    path: String,
    message: String,
    author_name: String,
    author_email: String,
) -> Result<String, String> {
    eprintln!("[git] commit_files: path={}, message={}, author={}", path, message, author_name);

    // Use git command for better reliability
    let _ = Command::new("git")
        .creation_flags(0x08000000)
        .args(["config", "user.name", &author_name])
        .current_dir(&path)
        .output()
        .map_err(|e| e.to_string())?;

    let _ = Command::new("git")
        .creation_flags(0x08000000)
        .args(["config", "user.email", &author_email])
        .current_dir(&path)
        .output()
        .map_err(|e| e.to_string())?;

    let output = Command::new("git")
        .creation_flags(0x08000000)
        .args(["commit", "-m", &message])
        .current_dir(&path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        eprintln!("[git] commit failed: {}", err);
        return Err(err.to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    eprintln!("[git] commit success: {}", stdout);
    Ok("committed".to_string())
}

#[tauri::command]
pub async fn get_commit_history(path: String, limit: u32, offset: u32) -> Result<Vec<CommitInfo>, String> {
    let path_clone = path.clone();
    spawn_blocking(move || {
        get_commit_history_sync(path_clone, limit, offset)
    }).await.map_err(|e| e.to_string())?
}

fn get_commit_history_sync(path: String, limit: u32, offset: u32) -> Result<Vec<CommitInfo>, String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;

    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    revwalk.set_sorting(Sort::TIME).map_err(|e| e.to_string())?;
    revwalk.push_head().map_err(|e| e.to_string())?;

    let mut commits = Vec::new();
    let mut count = 0;
    let mut skipped = 0;

    for oid in revwalk {
        // Skip offset commits
        if skipped < offset {
            skipped += 1;
            continue;
        }
        if count >= limit {
            break;
        }
        let oid = oid.map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;

        let hash = oid.to_string();
        let short_hash = hash[..7].to_string();
        let message = commit.message().unwrap_or("").trim().to_string();
        let author = commit.author().to_string();
        let author_name = commit.author().name().unwrap_or("Unknown").to_string();
        let author_email = commit.author().email().unwrap_or("").to_string();
        let time = commit.time();
        let date = format_time(&time);
        let relative_date = format_relative_time(&time);

        // Calculate actual files changed by diffing with parent
        let parent_tree = commit.parents().next().and_then(|p| {
            repo.find_tree(p.tree_id()).ok()
        });

        let files_count = if let Some(parent) = parent_tree {
            let tree = commit.tree().ok();
            if let Some(tree) = tree {
                let diff = repo.diff_tree_to_tree(Some(&parent), Some(&tree), None).ok();
                diff.map(|d| d.deltas().len() as u32).unwrap_or(1)
            } else {
                1
            }
        } else {
            // Initial commit - count entries in tree
            commit.tree().map(|t| t.len() as u32).unwrap_or(1)
        };

        commits.push(CommitInfo {
            hash,
            short_hash,
            message,
            author,
            author_name,
            author_email,
            date,
            relative_date,
            files_count,
        });

        count += 1;
    }

    Ok(commits)
}

#[tauri::command]
pub async fn get_commit_files(
    path: String,
    #[allow(non_snake_case)]
    commitHash: String,
) -> Result<Vec<FileChange>, String> {
    let path_clone = path.clone();
    let commit_hash_clone = commitHash.clone();
    spawn_blocking(move || {
        get_commit_files_sync(path_clone, commit_hash_clone)
    }).await.map_err(|e| e.to_string())?
}

fn get_commit_files_sync(
    path: String,
    commit_hash: String,
) -> Result<Vec<FileChange>, String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;

    let oid = git2::Oid::from_str(&commit_hash).map_err(|e| e.to_string())?;
    let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
    let tree = commit.tree().map_err(|e| e.to_string())?;

    let parent_tree = commit.parents().next().and_then(|p| {
        repo.find_tree(p.tree_id()).ok()
    });

    let mut changes = Vec::new();

    if let Some(parent) = parent_tree {
        let diff = repo
            .diff_tree_to_tree(Some(&parent), Some(&tree), None)
            .map_err(|e| e.to_string())?;

        for delta in diff.deltas() {
            let path_str = delta.new_file().path().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
            let change_type = match delta.status() {
                Delta::Added => "added",
                Delta::Deleted => "deleted",
                Delta::Modified => "modified",
                _ => "modified",
            };
            changes.push(FileChange {
                path: path_str,
                change_type: change_type.to_string(),
            });
        }
    } else {
        // Initial commit - all files are added
        for i in 0..tree.len() {
            if let Some(entry) = tree.get(i) {
                let path_str = entry.name().map(|n| n.to_string()).unwrap_or_default();
                changes.push(FileChange {
                    path: path_str,
                    change_type: "added".to_string(),
                });
            }
        }
    }

    Ok(changes)
}

#[tauri::command]
pub async fn get_diff(
    path: String,
    #[allow(non_snake_case)]
    filePath: String,
    #[allow(non_snake_case)]
    commitHash: Option<String>,
) -> Result<String, String> {
    let path_clone = path.clone();
    let file_path_clone = filePath.clone();
    let commit_hash_clone = commitHash.clone();
    spawn_blocking(move || {
        get_diff_sync(path_clone, file_path_clone, commit_hash_clone)
    }).await.map_err(|e| e.to_string())?
}

fn get_diff_sync(
    path: String,
    file_path: String,
    commit_hash: Option<String>,
) -> Result<String, String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let workdir = repo.workdir().ok_or("Not a workdir")?.to_string_lossy().to_string();

    let diff_str = if let Some(hash) = commit_hash {
        // Diff for commit - show full patch content
        let oid = git2::Oid::from_str(&hash).map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        let commit_tree = commit.tree().map_err(|e| e.to_string())?;

        let parent_tree = commit.parents().next().and_then(|p| {
            repo.find_tree(p.tree_id()).ok()
        });

        if let Some(_parent) = parent_tree {
            // Use git command to get proper patch format
            let output = Command::new("git")
                .creation_flags(0x08000000)
                .args(["diff-tree", "-p", &hash, "--", &file_path])
                .current_dir(&workdir)
                .output()
                .map_err(|e| e.to_string())?;

            let raw = String::from_utf8_lossy(&output.stdout).to_string();
            clean_diff_output(&raw)
        } else {
            // Initial commit - use git show
            let output = Command::new("git")
                .creation_flags(0x08000000)
                .args(["show", &hash, "--format=", "-p", "--", &file_path])
                .current_dir(&workdir)
                .output()
                .map_err(|e| e.to_string())?;

            if output.status.success() {
                let raw = String::from_utf8_lossy(&output.stdout).to_string();
                clean_diff_output(&raw)
            } else {
                // Fallback - show only the specific file
                let mut result = String::new();
                result.push_str("初始提交：\n");
                for i in 0..commit_tree.len() {
                    if let Some(entry) = commit_tree.get(i) {
                        if let Some(name) = entry.name() {
                            if name == file_path {
                                result.push_str(&format!("+ {}\n", name));
                                break;
                            }
                        }
                    }
                }
                result
            }
        }
    } else {
        // Diff between workdir and index (unstaged changes) - use git diff for proper format
        let output = Command::new("git")
            .creation_flags(0x08000000)
            .args(["diff", "--", &file_path])
            .current_dir(&workdir)
            .output()
            .map_err(|e| e.to_string())?;

        if output.status.success() && !String::from_utf8_lossy(&output.stdout).is_empty() {
            let raw = String::from_utf8_lossy(&output.stdout).to_string();
            clean_diff_output(&raw)
        } else {
            // Fallback to reading file
            let file_abs_path = format!("{}/{}", workdir.trim_end_matches(['/', '\\']), file_path);
            if let Ok(content) = std::fs::read_to_string(&file_abs_path) {
                let mut result = String::new();
                result.push_str("新文件: ");
                result.push_str(&file_path);
                result.push_str("\n\n");
                for line in content.lines() {
                    result.push_str("+");
                    result.push_str(line);
                    result.push('\n');
                }
                result
            } else {
                String::new()
            }
        }
    };

    Ok(diff_str)
}

// 清理 diff 输出，只保留用户关心的内容
fn clean_diff_output(raw: &str) -> String {
    let mut result = String::new();
    let mut in_hunk = false;

    for line in raw.lines() {
        // 跳过 git diff 的头部信息
        if line.starts_with("diff --git") {
            continue;
        }
        if line.starts_with("index ") || line.starts_with("similarity index") || line.starts_with("rename from") || line.starts_with("rename to") {
            continue;
        }
        if line.starts_with("--- a/") || line.starts_with("+++ b/") {
            continue;
        }

        // hunk 头保留但简化
        if line.starts_with("@@") {
            // 提取行号信息
            if let Some(hunk_info) = extract_hunk_info(&line) {
                if !result.ends_with('\n') {
                    result.push('\n');
                }
                result.push_str(&hunk_info);
                result.push_str("\n\n");
            }
            in_hunk = true;
            continue;
        }

        // 保留实际变更的内容
        if in_hunk {
            if line.starts_with('+') && !line.starts_with("+++") {
                // 跳过 "\ No newline at end of file"
                if line == "\\ No newline at end of file" {
                    continue;
                }
                result.push_str(line);
                result.push('\n');
            } else if line.starts_with('-') && !line.starts_with("---") {
                if line == "\\ No newline at end of file" {
                    continue;
                }
                result.push_str(line);
                result.push('\n');
            } else if line.starts_with(' ') || line.is_empty() {
                // 上下文行，保留但不要太密集
                if !result.ends_with('\n') {
                    result.push('\n');
                }
                result.push_str(line);
                result.push('\n');
            }
        }
    }

    // 清理末尾多余空行
    while result.ends_with('\n') {
        result.pop();
    }

    if result.is_empty() {
        result.push_str("(没有文本变化)");
    }

    result
}

fn extract_hunk_info(line: &str) -> Option<String> {
    // 保留原始 hunk 头，包含行号信息
    Some(line.to_string())
}

#[tauri::command]
pub async fn get_branches(path: String) -> Result<Vec<BranchInfo>, String> {
    let path_clone = path.clone();
    spawn_blocking(move || {
        get_branches_sync(path_clone)
    }).await.map_err(|e| e.to_string())?
}

fn get_branches_sync(path: String) -> Result<Vec<BranchInfo>, String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let current_head = repo.head().ok();
    let current_branch_name = current_head.as_ref()
        .and_then(|h| h.shorthand().map(|s| s.to_string()));

    let mut branches = Vec::new();

    for branch_result in repo.branches(Some(git2::BranchType::Local)).map_err(|e| e.to_string())? {
        let (branch, _) = branch_result.map_err(|e| e.to_string())?;
        let name = branch.name().map_err(|e| e.to_string())?.unwrap_or("").to_string();
        let is_current = current_branch_name.as_ref().map(|n| n == &name).unwrap_or(false);
        branches.push(BranchInfo { name, is_current });
    }

    Ok(branches)
}

#[tauri::command]
pub fn get_current_branch(path: String) -> Result<String, String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    let branch_name = repo.head()
        .map_err(|e| e.to_string())?
        .shorthand()
        .map(|s| s.to_string())
        .ok_or_else(|| "No head".to_string())?;
    Ok(branch_name)
}

#[tauri::command]
pub async fn checkout_branch(path: String, branch: String) -> Result<(), String> {
    let path_clone = path.clone();
    let branch_clone = branch.clone();
    spawn_blocking(move || {
        checkout_branch_sync(path_clone, branch_clone)
    }).await.map_err(|e| e.to_string())?
}

fn checkout_branch_sync(path: String, branch: String) -> Result<(), String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;

    let reference = repo.find_branch(&branch, git2::BranchType::Local).map_err(|e| e.to_string())?;
    let commit = reference.get().peel_to_commit().map_err(|e| e.to_string())?;

    repo.checkout_tree(commit.as_object(), None).map_err(|e| e.to_string())?;
    repo.set_head(&format!("refs/heads/{}", branch)).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_workdir(path: String) -> Result<String, String> {
    let repo = Repository::discover(&path).map_err(|e| e.to_string())?;
    repo.workdir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Not a workdir".to_string())
}

// 在文件管理器中显示文件
#[tauri::command]
pub fn show_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(std::path::Path::new(&path).parent().unwrap_or(std::path::Path::new(&path)))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ============= Git Account Commands =============

#[derive(Debug, Serialize, Deserialize)]
pub struct GitAccount {
    pub name: String,
    pub email: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DetectedAccount {
    pub found: bool,
    pub account: Option<GitAccount>,
    pub source: String,  // "local" or "global"
}

/// 检测 git 账号（异步，不阻塞主线程）
#[tauri::command]
pub async fn detect_git_account(path: String) -> Result<DetectedAccount, String> {
    // 使用 spawn_blocking 在后台线程执行 git 命令
    let result = spawn_blocking(move || {
        detect_git_account_sync(&path)
    }).await.map_err(|e| e.to_string())?;

    Ok(result)
}

fn detect_git_account_sync(path: &str) -> DetectedAccount {
    // 1. 尝试本地配置
    if let Some(account) = read_git_config_local(path) {
        return DetectedAccount {
            found: true,
            account: Some(account),
            source: "local".to_string(),
        };
    }

    // 2. 尝试全局配置
    if let Some(account) = read_git_config_global() {
        return DetectedAccount {
            found: true,
            account: Some(account),
            source: "global".to_string(),
        };
    }

    // 3. 都未找到
    DetectedAccount {
        found: false,
        account: None,
        source: String::new(),
    }
}

fn read_git_config_local(repo_path: &str) -> Option<GitAccount> {
    let output = Command::new("git")
        .creation_flags(0x08000000)
        .args(["config", "--local", "user.name"])
        .current_dir(repo_path)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if name.is_empty() {
        return None;
    }

    let output = Command::new("git")
        .creation_flags(0x08000000)
        .args(["config", "--local", "user.email"])
        .current_dir(repo_path)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let email = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if email.is_empty() {
        return None;
    }

    Some(GitAccount { name, email })
}

fn read_git_config_global() -> Option<GitAccount> {
    let output = Command::new("git")
        .creation_flags(0x08000000)
        .args(["config", "--global", "user.name"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if name.is_empty() {
        return None;
    }

    let output = Command::new("git")
        .creation_flags(0x08000000)
        .args(["config", "--global", "user.email"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let email = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if email.is_empty() {
        return None;
    }

    Some(GitAccount { name, email })
}

/// 设置仓库的本地 git 账号
#[tauri::command]
pub async fn set_git_account(path: String, name: String, email: String) -> Result<(), String> {
    let path_clone = path.clone();
    let name_clone = name.clone();
    let email_clone = email.clone();

    spawn_blocking(move || {
        set_git_account_sync(&path_clone, &name_clone, &email_clone)
    }).await.map_err(|e| e.to_string()).and_then(|r| r)
}

fn set_git_account_sync(path: &str, name: &str, email: &str) -> Result<(), String> {
    // 设置 user.name
    let output = Command::new("git")
        .creation_flags(0x08000000)
        .args(["config", "--local", "user.name", name])
        .current_dir(path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("设置用户名失败: {}", err));
    }

    // 设置 user.email
    let output = Command::new("git")
        .creation_flags(0x08000000)
        .args(["config", "--local", "user.email", email])
        .current_dir(path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("设置邮箱失败: {}", err));
    }

    Ok(())
}
