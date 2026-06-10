# Discord Global Chat Bot

Production-ready, containerized global chat relay bot for Discord using Node.js + discord.js.

## One-Line Install

Run this in the project root:

```bash
chmod +x setup.sh && ./setup.sh
```

Run this from any SSH terminal (fresh machine):

```bash
git clone https://github.com/beaudenison/discordglobalchat.git && cd discordglobalchat && chmod +x setup.sh && ./setup.sh
```

The setup wizard will:
1. Verify Docker and Docker Compose are installed (and install on Ubuntu/Debian when missing).
2. Ask for your Discord Bot Token and Application ID.
3. Generate a correct OAuth2 invite link with required scopes and permissions.
4. Securely write your `.env` file.
5. Start the bot with Docker Compose.

## Discord Developer Portal Checklist

1. Open: https://discord.com/developers/applications
2. Create/select your app.
3. In Bot settings:
	- Create/reset token and copy it.
	- Enable **Message Content Intent**.
4. In OAuth2 > General, copy **Application ID**.
5. Run setup script and paste values when prompted.

## Generated OAuth2 Permissions

The setup script generates an invite URL with:
- Scopes: `bot`, `applications.commands`
- Permissions: `Manage Webhooks`, `Send Messages`

Permission integer used: `536889344`.

## Slash Commands

Administrator-only commands:

1. `/set-broadcast-channel [channel]`
2. `/set-receive-channel [channel]`

Channel routing behavior:
- Same channel for both commands: fully bidirectional global room in one channel.
- Different channels: strict split routing (outbound from broadcast channel, inbound to receive channel).

## Relay Pipeline

When a user posts in the configured broadcast channel:
1. Bot ignores bot/webhook/system bot messages.
2. Message is relayed to receive channels of all other configured guilds.
3. Bot uses channel webhooks (created dynamically if needed) to preserve sender identity context:
	- Username: `Global Chat`
	- Avatar: sender avatar
4. Delivered message includes:
	- User reference via `<@UserID>`
	- Server name in plain text attribution.

## Project Structure

```text
.
├── data/
│   └── .gitkeep
├── src/
│   ├── commands.js
│   ├── index.js
│   └── storage.js
├── .dockerignore
├── .env.example
├── .gitignore
├── Dockerfile
├── docker-compose.yml
├── package.json
├── README.md
└── setup.sh
```

## Docker

Build and run manually:

```bash
docker compose up --build -d
```

Stop:

```bash
docker compose down
```

Logs:

```bash
docker compose logs -f bot
```

Persistent config is stored in `./data` and mounted into the container at `/app/data`.

## Environment Variables

Defined in `.env`:

- `BOT_TOKEN` (required)
- `CLIENT_ID` (required)
- `DATA_FILE` (default: `/app/data/config.json`)
- `LOG_LEVEL` (default: `info`)

## Security Notes

- `.env` is written with mode `600` by setup script.
- Bot ignores messages from bots to prevent relay loops.
- Slash commands enforce Administrator-only usage with default command permissions and runtime checks.

## Operational Notes

- Slash commands are registered globally on startup.
- Global command propagation can take some minutes on Discord.
- Ensure bot has channel permissions in every target receive channel:
  - View Channel
  - Send Messages
  - Manage Webhooks