use serde::{Deserialize, Serialize};
use std::fs;
use walkdir::WalkDir;

mod commands;

#[derive(Debug, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FolderContents {
    pub path: String,
    pub name: String,
    pub entries: Vec<FileEntry>,
}

// 排序比较函数：文件夹在前，然后按名称排序
fn compare_entries(a: &FileEntry, b: &FileEntry) -> std::cmp::Ordering {
    // 1. 文件夹排在前面
    if a.is_dir != b.is_dir {
        if a.is_dir {
            return std::cmp::Ordering::Less;
        } else {
            return std::cmp::Ordering::Greater;
        }
    }
    // 2. 按名称排序（case-insensitive）
    a.name.to_lowercase().cmp(&b.name.to_lowercase())
}

// 读取文件夹内容
#[tauri::command]
fn read_directory(path: &str) -> Result<FolderContents, String> {
    let path_buf = std::path::PathBuf::from(path);
    if !path_buf.exists() {
        return Err("Path does not exist".to_string());
    }
    if !path_buf.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    let name = path_buf
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());

    let mut entries: Vec<FileEntry> = Vec::new();

    for entry in WalkDir::new(path).max_depth(1) {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_path = entry.path();

        // 跳过当前目录本身
        if entry_path == path_buf {
            continue;
        }

        let file_name = entry_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        // 只添加 .md 文件和目录
        if entry_path.is_dir() || file_name.ends_with(".md") {
            entries.push(FileEntry {
                name: file_name,
                path: entry_path.to_string_lossy().to_string(),
                is_dir: entry_path.is_dir(),
            });
        }
    }

    // 排序：文件夹在前，然后按名称排序
    entries.sort_by(compare_entries);

    Ok(FolderContents {
        path: path.to_string(),
        name,
        entries,
    })
}

// 读取文件内容
#[tauri::command]
fn read_file(path: &str) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

// 写入文件
#[tauri::command]
fn write_file(path: &str, content: &str) -> Result<bool, String> {
    fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(true)
}

// 获取文件修改时间（Unix 时间戳，毫秒）
#[tauri::command]
fn get_file_modified_time(path: &str) -> Result<u64, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    let modified = metadata.modified().map_err(|e| e.to_string())?;
    let duration = modified.duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?;
    Ok(duration.as_millis() as u64)
}

// 读取文件内容并返回修改时间
#[derive(Serialize)]
struct FileContentWithMtime {
    content: String,
    modified_time: u64,
}

#[tauri::command]
fn read_file_with_mtime(path: &str) -> Result<FileContentWithMtime, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    let modified = metadata.modified().map_err(|e| e.to_string())?;
    let duration = modified.duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?;
    let modified_time = duration.as_millis() as u64;
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    Ok(FileContentWithMtime { content, modified_time })
}

// 删除文件
#[tauri::command]
fn delete_file(path: &str) -> Result<bool, String> {
    fs::remove_file(path).map_err(|e| e.to_string())?;
    Ok(true)
}

// 重命名文件
#[tauri::command]
fn rename_file(old_path: &str, new_path: &str) -> Result<bool, String> {
    fs::rename(old_path, new_path).map_err(|e| e.to_string())?;
    Ok(true)
}

// 创建目录
#[tauri::command]
fn create_directory(path: &str) -> Result<bool, String> {
    fs::create_dir(path).map_err(|e| e.to_string())?;
    Ok(true)
}

// 删除目录
#[tauri::command]
fn delete_directory(path: &str) -> Result<bool, String> {
    fs::remove_dir_all(path).map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            read_directory, read_file, write_file, get_file_modified_time, read_file_with_mtime, delete_file, rename_file, create_directory, delete_directory,
            commands::git::get_repo_info,
            commands::git::init_repository,
            commands::git::get_repository_status,
            commands::git::stage_files,
            commands::git::unstage_files,
            commands::git::stage_all,
            commands::git::unstage_all,
            commands::git::commit_files,
            commands::git::get_commit_history,
            commands::git::get_commit_files,
            commands::git::get_diff,
            commands::git::get_branches,
            commands::git::get_current_branch,
            commands::git::checkout_branch,
            commands::git::get_workdir,
            commands::git::show_in_explorer,
            commands::git::detect_git_account,
            commands::git::set_git_account,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
