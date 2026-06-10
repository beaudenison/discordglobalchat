import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_SCHEMA = {
  guilds: {}
};

export class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.ensure();
  }

  ensure() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, `${JSON.stringify(DEFAULT_SCHEMA, null, 2)}\n`, 'utf8');
    }

    const current = this.read();
    if (!current.guilds || typeof current.guilds !== 'object') {
      this.write(DEFAULT_SCHEMA);
    }
  }

  read() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      return { ...DEFAULT_SCHEMA };
    }
  }

  write(data) {
    fs.writeFileSync(this.filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  }

  getGuild(guildId) {
    const data = this.read();
    return data.guilds[guildId] || null;
  }

  upsertGuild(guildId, patch) {
    const data = this.read();
    const existing = data.guilds[guildId] || {};
    data.guilds[guildId] = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    this.write(data);
    return data.guilds[guildId];
  }

  getAllGuilds() {
    const data = this.read();
    return data.guilds || {};
  }
}
