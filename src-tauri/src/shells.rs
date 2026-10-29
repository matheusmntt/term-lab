use portable_pty::CommandBuilder;
use std::{fs, path::{Path, PathBuf}, sync::OnceLock};

// Integração com shells (zsh, bash e fish):
// Emite sequências OSC interpretadas pelo frontend:
//   OSC 133;C        -> comando começou a executar (bolinha amarela)
//   OSC 133;D;<code> -> comando terminou com exit code (verde = 0/130, vermelha = erro)
//   OSC 7            -> diretório atual (título da aba e persistência de sessão/grupos)

const ZSHENV: &str = r#"__tl_ours="$ZDOTDIR"
ZDOTDIR="$TERMLAB_USER_ZDOTDIR"
[[ -f "$ZDOTDIR/.zshenv" ]] && source "$ZDOTDIR/.zshenv"
ZDOTDIR="$__tl_ours"
unset __tl_ours
"#;

const ZPROFILE: &str = r#"__tl_ours="$ZDOTDIR"
ZDOTDIR="$TERMLAB_USER_ZDOTDIR"
[[ -f "$ZDOTDIR/.zprofile" ]] && source "$ZDOTDIR/.zprofile"
ZDOTDIR="$__tl_ours"
unset __tl_ours
"#;

const ZSHRC: &str = r#"ZDOTDIR="$TERMLAB_USER_ZDOTDIR"
[[ -f "$ZDOTDIR/.zshrc" ]] && source "$ZDOTDIR/.zshrc"

__termlab_preexec() { printf '\e]133;C\a' }
__termlab_precmd() {
  local c=$?
  printf '\e]133;D;%s\a' "$c"
  printf '\e]7;file://%s%s\a' "$HOST" "${PWD// /%20}"
}
autoload -Uz add-zsh-hook
add-zsh-hook preexec __termlab_preexec
add-zsh-hook precmd __termlab_precmd
precmd_functions=(__termlab_precmd ${precmd_functions:#__termlab_precmd})
"#;

const BASHRC: &str = r#"[[ -f /etc/profile ]] && source /etc/profile
if [[ -f "$HOME/.bash_profile" ]]; then
  source "$HOME/.bash_profile"
elif [[ -f "$HOME/.bash_login" ]]; then
  source "$HOME/.bash_login"
elif [[ -f "$HOME/.profile" ]]; then
  source "$HOME/.profile"
elif [[ -f "$HOME/.bashrc" ]]; then
  source "$HOME/.bashrc"
fi

__termlab_in_cmd=0
__termlab_ready=0
__termlab_precmd() {
  local c=$?
  __termlab_ready=0
  __termlab_in_cmd=0
  printf '\e]133;D;%s\a' "$c"
  printf '\e]7;file://%s%s\a' "${HOSTNAME}" "${PWD// /%20}"
}
__termlab_arm() { __termlab_ready=1; }
__termlab_preexec() {
  local s=$?
  if [[ "$__termlab_ready" == "1" && "$__termlab_in_cmd" == "0" && "$BASH_COMMAND" != "__termlab_"* ]]; then
    __termlab_in_cmd=1
    printf '\e]133;C\a'
  fi
  return $s
}
if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then
  PROMPT_COMMAND=(__termlab_precmd "${PROMPT_COMMAND[@]}" __termlab_arm)
else
  __tl_pc="${PROMPT_COMMAND#"${PROMPT_COMMAND%%[![:space:]]*}"}"
  __tl_pc="${__tl_pc%"${__tl_pc##*[![:space:];]}"}"
  PROMPT_COMMAND="__termlab_precmd${__tl_pc:+; $__tl_pc}; __termlab_arm"
  unset __tl_pc
fi
trap '__termlab_preexec' DEBUG
"#;

const FISH_INIT: &str = r#"function __termlab_preexec --on-event fish_preexec
  printf '\e]133;C\a'
end
function __termlab_prompt --on-event fish_prompt
  set -l c $status
  printf '\e]133;D;%s\a' $c
  printf '\e]7;file://%s%s\a' (hostname) (string replace -a ' ' '%20' -- $PWD)
end
__termlab_prompt"#;

static ZSH_DIR: OnceLock<Option<PathBuf>> = OnceLock::new();
static BASH_RC: OnceLock<Option<PathBuf>> = OnceLock::new();

fn zsh_integration_dir() -> Option<PathBuf> {
    ZSH_DIR
        .get_or_init(|| {
            let dir = std::env::temp_dir().join("termlab-zsh");
            fs::create_dir_all(&dir).ok()?;
            for (name, body) in [(".zshenv", ZSHENV), (".zprofile", ZPROFILE), (".zshrc", ZSHRC)] {
                fs::write(dir.join(name), body).ok()?;
            }
            Some(dir)
        })
        .clone()
}

fn bash_integration_rc() -> Option<PathBuf> {
    BASH_RC
        .get_or_init(|| {
            let dir = std::env::temp_dir().join("termlab-bash");
            fs::create_dir_all(&dir).ok()?;
            let rc = dir.join("bashrc");
            fs::write(&rc, BASHRC).ok()?;
            Some(rc)
        })
        .clone()
}

pub fn build_shell_command(shell_override: Option<String>, cwd: Option<String>) -> CommandBuilder {
    let shell = shell_override
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| std::env::var("SHELL").ok())
        .unwrap_or_else(|| "/bin/zsh".into());

    let name = Path::new(&shell)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");

    let mut cmd = CommandBuilder::new(&shell);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    match name {
        "zsh" => {
            cmd.arg("-l");
            if let Some(dir) = zsh_integration_dir() {
                let user_zdotdir = std::env::var("ZDOTDIR")
                    .or_else(|_| std::env::var("HOME"))
                    .unwrap_or_default();
                cmd.env("TERMLAB_USER_ZDOTDIR", user_zdotdir);
                cmd.env("ZDOTDIR", dir);
            }
        }
        "bash" => {
            if let Some(rc) = bash_integration_rc() {
                cmd.arg("--rcfile");
                cmd.arg(rc);
                cmd.arg("-i");
            } else {
                cmd.arg("-l");
            }
        }
        "fish" => {
            cmd.args(["-l", "--init-command", FISH_INIT]);
        }
        _ => {
            cmd.arg("-l");
        }
    }

    let start_dir = cwd
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from));
    if let Some(dir) = start_dir {
        cmd.cwd(dir);
    }

    cmd
}
