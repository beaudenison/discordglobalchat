#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$PROJECT_DIR/.env"
PERMISSIONS_INT=536889344

print_step() {
  printf "\n==> %s\n" "$1"
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

ensure_docker() {
  if command_exists docker; then
    return
  fi

  print_step "Docker not found"
  echo "Attempting automatic Docker installation for Ubuntu/Debian..."

  if ! command_exists apt-get; then
    echo "Could not find apt-get. Install Docker manually: https://docs.docker.com/engine/install/"
    exit 1
  fi

  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg lsb-release
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg

  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

ensure_compose() {
  if docker compose version >/dev/null 2>&1; then
    return
  fi

  print_step "Docker Compose plugin not found"

  if command_exists apt-get; then
    sudo apt-get update
    sudo apt-get install -y docker-compose-plugin
  else
    echo "Install Docker Compose plugin manually: https://docs.docker.com/compose/install/"
    exit 1
  fi
}

wizard() {
  print_step "Discord Global Chat Bot Setup Wizard"
  cat <<'EOF'
You need two values from the Discord Developer Portal:
1) Bot Token
2) Application ID (Client ID)

Portal walkthrough:
- Open https://discord.com/developers/applications
- Create or select an application
- In Bot settings: create/reset token and copy it
- In OAuth2 > General: copy the Application ID
- In Bot settings, enable MESSAGE CONTENT INTENT
EOF

  read -rp "Enter Discord Bot Token: " BOT_TOKEN
  while [[ -z "${BOT_TOKEN}" ]]; do
    read -rp "Bot Token cannot be empty. Enter Discord Bot Token: " BOT_TOKEN
  done

  read -rp "Enter Discord Application ID (Client ID): " CLIENT_ID
  while [[ -z "${CLIENT_ID}" ]]; do
    read -rp "Application ID cannot be empty. Enter Discord Application ID: " CLIENT_ID
  done

  read -rp "Optional: Enter your permanent server invite URL (or leave blank): " SERVER_INVITE_URL

  INVITE_URL="https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&permissions=${PERMISSIONS_INT}&scope=bot%20applications.commands"

  print_step "Generated Bot Invite URL"
  echo "$INVITE_URL"

  print_step "Writing .env"
  {
    echo "BOT_TOKEN=${BOT_TOKEN}"
    echo "CLIENT_ID=${CLIENT_ID}"
    echo "DATA_FILE=/app/data/config.json"
    echo "LOG_LEVEL=info"
    if [[ -n "${SERVER_INVITE_URL}" ]]; then
      echo "DEFAULT_SERVER_INVITE_URL=${SERVER_INVITE_URL}"
    fi
  } > "$ENV_FILE"

  chmod 600 "$ENV_FILE"
  echo "Saved ${ENV_FILE} with restricted permissions (600)."
}

start_stack() {
  print_step "Building and starting containers"
  cd "$PROJECT_DIR"
  docker compose up --build -d

  print_step "Bot deployment complete"
  docker compose ps
  echo
  echo "Next steps:"
  echo "1) Use the generated invite URL to add the bot to each server"
  echo "2) In each server, run /set-broadcast-channel and /set-receive-channel"
  echo "3) Optional: run /set-server-invite for clickable server attribution"
}

main() {
  ensure_docker
  ensure_compose
  wizard
  start_stack
}

main "$@"
