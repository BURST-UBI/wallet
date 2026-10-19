use std::fs::{File, OpenOptions, TryLockError};
use std::path::Path;

/// The OS releases this lease on process exit, including a crash. Never unlink
/// the lock file: another process may still hold its inode open.
pub(crate) struct ProfileAccess {
    lease: Option<File>,
}

impl ProfileAccess {
    pub(crate) fn open(directory: &Path) -> std::io::Result<Self> {
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options.open(directory.join(".signing.lock"))?;
        match file.try_lock() {
            Ok(()) => Ok(Self { lease: Some(file) }),
            Err(TryLockError::WouldBlock) => Ok(Self { lease: None }),
            Err(TryLockError::Error(error)) => Err(error),
        }
    }

    pub(crate) fn require_signer(&self) -> Result<(), String> {
        if self.lease.is_some() {
            Ok(())
        } else {
            Err("This wallet profile is open in another process. This window is read-only; close the other process and reopen this window to sign.".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_access_competing_handles_are_read_only_and_exit_releases_lease() {
        let directory = tempfile::tempdir().unwrap();
        let first = ProfileAccess::open(directory.path()).unwrap();
        assert!(first.require_signer().is_ok());
        let second = ProfileAccess::open(directory.path()).unwrap();
        assert!(second.require_signer().is_err());
        drop(first);
        assert!(ProfileAccess::open(directory.path())
            .unwrap()
            .require_signer()
            .is_ok());
        assert!(second.require_signer().is_err());
    }

    #[test]
    fn profile_access_child_process() {
        let Some(path) = std::env::var_os("BURST_PROFILE_LEASE_TEST_DIR") else {
            return;
        };
        let access = ProfileAccess::open(Path::new(&path)).unwrap();
        let expected = std::env::var("BURST_PROFILE_LEASE_EXPECT_SIGNER").unwrap() == "yes";
        assert_eq!(access.require_signer().is_ok(), expected);
        if std::env::var_os("BURST_PROFILE_LEASE_HOLD").is_some() {
            use std::io::{Read, Write};
            assert!(access.require_signer().is_ok());
            println!("BURST_PROFILE_LEASE_READY");
            std::io::stdout().flush().unwrap();
            let mut byte = [0];
            let _ = std::io::stdin().read_exact(&mut byte);
        }
    }

    #[test]
    fn profile_access_independent_processes_observe_the_same_lease() {
        let directory = tempfile::tempdir().unwrap();
        let owner = ProfileAccess::open(directory.path()).unwrap();
        let child = |expected| {
            std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "profile_access::tests::profile_access_child_process",
                    "--nocapture",
                ])
                .env("BURST_PROFILE_LEASE_TEST_DIR", directory.path())
                .env("BURST_PROFILE_LEASE_EXPECT_SIGNER", expected)
                .status()
                .unwrap()
                .success()
        };
        assert!(child("no"));
        drop(owner);
        assert!(child("yes"));
    }

    #[test]
    fn profile_access_killed_owner_releases_lease_without_deleting_lock_file() {
        use std::io::{BufRead, BufReader};
        use std::process::{Command, Stdio};
        let directory = tempfile::tempdir().unwrap();
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "profile_access::tests::profile_access_child_process",
                "--nocapture",
            ])
            .env("BURST_PROFILE_LEASE_TEST_DIR", directory.path())
            .env("BURST_PROFILE_LEASE_EXPECT_SIGNER", "yes")
            .env("BURST_PROFILE_LEASE_HOLD", "yes")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut output = BufReader::new(child.stdout.take().unwrap());
        loop {
            let mut line = String::new();
            assert_ne!(
                output.read_line(&mut line).unwrap(),
                0,
                "owner exited before acquiring lease"
            );
            if line.contains("BURST_PROFILE_LEASE_READY") {
                break;
            }
        }
        assert!(ProfileAccess::open(directory.path())
            .unwrap()
            .require_signer()
            .is_err());
        child.kill().unwrap();
        assert!(!child.wait().unwrap().success());
        assert!(directory.path().join(".signing.lock").is_file());
        assert!(ProfileAccess::open(directory.path())
            .unwrap()
            .require_signer()
            .is_ok());
    }
}
