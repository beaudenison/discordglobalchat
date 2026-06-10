# Discord Global Chat Bot | Cross-Server Discord Chat Network

One bot. Every server. One conversation.

Global Chat connects Discord servers into one live, cross-server conversation. Install the bot in your server, choose your send/receive channels, and instantly join a decentralized network of communities talking in real time.

Website: https://discordglobalchat.xyz

## What Is Discord Global Chat?

Discord Global Chat is a production-ready, containerized global chat relay bot built with Node.js and discord.js. It links independent Discord communities together so messages can flow between connected servers without a centralized hub.

As more servers install the bot, the network expands automatically. More servers means more people, more reach, and a larger community conversation.

## Why Use Global Chat?

### Cross-server feed
Messages flow between connected Discord servers to create one shared conversation across communities.

### Grows with the network
Every new server increases network reach. Your community can instantly talk with people across the wider Global Chat network.

### Admin-controlled channels
Server admins choose exactly which channels broadcast outbound messages and which channels receive inbound messages.

### Decentralized by design
There is no single central chat hub. Servers connect organically into a member-driven network.

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
	- Lightweight delivery acknowledgement to the sender (`sent to X servers`) that auto-removes quickly to reduce channel clutter.

## Use Cases

- Connect multiple friend-group servers into one active shared chat.
- Let community servers discover and talk to each other in real time.
- Build a distributed, network-style chat ecosystem without migrating communities to a single server.
- Keep admin control local while participating in a larger global conversation.

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

## Keywords

Discord global chat bot, cross-server Discord bot, Discord relay bot, decentralized Discord network, shared Discord feed, multi-server Discord chat, global Discord conversation, Discord community growth bot.