extern crate alloc;
use alloc::vec::Vec;

/// Resolve a path against a working directory.
/// If path is absolute (starts with '/'), return it as-is.
/// If path is relative, prepend cwd + '/'.
pub fn resolve_path(path: &[u8], cwd: &[u8]) -> Vec<u8> {
    if path.first() == Some(&b'/') {
        return path.to_vec();
    }
    let mut resolved = cwd.to_vec();
    if resolved.last() != Some(&b'/') {
        resolved.push(b'/');
    }
    resolved.extend_from_slice(path);
    resolved
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_absolute_path_unchanged() {
        let resolved = resolve_path(b"/home/user/file.txt", b"/working/dir");
        assert_eq!(resolved, b"/home/user/file.txt");
    }

    #[test]
    fn test_relative_path_prepends_cwd() {
        let resolved = resolve_path(b"file.txt", b"/working/dir");
        assert_eq!(resolved, b"/working/dir/file.txt");
    }

    #[test]
    fn test_relative_path_with_cwd_root() {
        let resolved = resolve_path(b"file.txt", b"/");
        assert_eq!(resolved, b"/file.txt");
    }

    #[test]
    fn test_dot_relative_path() {
        let resolved = resolve_path(b"./file.txt", b"/working/dir");
        assert_eq!(resolved, b"/working/dir/./file.txt");
    }

    #[test]
    fn test_empty_path() {
        let resolved = resolve_path(b"", b"/working/dir");
        assert_eq!(resolved, b"/working/dir/");
    }
}
