import { prisma } from '../config/prisma';
import { keyed_serial_executor } from './keyed_serial_executor';

export interface session_handoff_info {
  account_id: number | string;
  conversation_id: number | string;
  handed_off_at: number;
  reason?: string;
}

export interface pending_session_info {
  account_id: number | string;
  conversation_id: number | string;
  sender_identifier: string;
  pending_count: number;
}

export interface session_store {
  activate_handoff(
    account_id: number | string,
    conversation_id: number | string,
    reason?: string
  ): Promise<void>;

  release_handoff(
    account_id: number | string,
    conversation_id: number | string
  ): Promise<void>;

  load_active_handoffs(): Promise<session_handoff_info[]>;

  append_pending_message(
    account_id: number | string,
    conversation_id: number | string,
    sender_identifier: string,
    content: string,
    max_cap?: number
  ): Promise<number>;

  consume_pending_messages(
    account_id: number | string,
    conversation_id: number | string
  ): Promise<string[]>;

  list_sessions_with_pending(): Promise<pending_session_info[]>;

  clear_all(): Promise<void>;
}

export class prisma_session_store implements session_store {
  private executor: keyed_serial_executor;

  constructor(executor?: keyed_serial_executor) {
    this.executor = executor || new keyed_serial_executor();
  }

  private get_session_key(account_id: number | string, conversation_id: number | string): string {
    return `${account_id}_${conversation_id}`;
  }

  public async activate_handoff(
    account_id: number | string,
    conversation_id: number | string,
    reason?: string
  ): Promise<void> {
    const session_key = this.get_session_key(account_id, conversation_id);
    await this.executor.run(session_key, async () => {
      const now = new Date();
      await prisma.conversation_session.upsert({
        where: { session_key },
        update: {
          handoff_active: true,
          handoff_reason: reason || null,
          handed_off_at: now,
        },
        create: {
          session_key,
          account_id: String(account_id),
          conversation_id: String(conversation_id),
          handoff_active: true,
          handoff_reason: reason || null,
          handed_off_at: now,
        },
      });
    });
  }

  public async release_handoff(
    account_id: number | string,
    conversation_id: number | string
  ): Promise<void> {
    const session_key = this.get_session_key(account_id, conversation_id);
    await this.executor.run(session_key, async () => {
      await prisma.conversation_session.updateMany({
        where: { session_key },
        data: {
          handoff_active: false,
          handoff_reason: null,
          handed_off_at: null,
        },
      });
    });
  }

  public async load_active_handoffs(): Promise<session_handoff_info[]> {
    const rows = await prisma.conversation_session.findMany({
      where: { handoff_active: true },
    });

    return rows.map((row) => ({
      account_id: row.account_id,
      conversation_id: row.conversation_id,
      handed_off_at: row.handed_off_at ? row.handed_off_at.getTime() : Date.now(),
      reason: row.handoff_reason || undefined,
    }));
  }

  public async append_pending_message(
    account_id: number | string,
    conversation_id: number | string,
    sender_identifier: string,
    content: string,
    max_cap?: number
  ): Promise<number> {
    const session_key = this.get_session_key(account_id, conversation_id);
    return this.executor.run(session_key, async () => {
      await prisma.conversation_session.upsert({
        where: { session_key },
        update: {
          sender_identifier,
        },
        create: {
          session_key,
          account_id: String(account_id),
          conversation_id: String(conversation_id),
          sender_identifier,
        },
      });

      const count = await prisma.pending_message.count({
        where: { session_key },
      });

      if (max_cap !== undefined && count >= max_cap) {
        return count;
      }

      await prisma.pending_message.create({
        data: {
          session_key,
          content,
        },
      });

      return count + 1;
    });
  }

  public async consume_pending_messages(
    account_id: number | string,
    conversation_id: number | string
  ): Promise<string[]> {
    const session_key = this.get_session_key(account_id, conversation_id);
    return this.executor.run(session_key, async () => {
      return prisma.$transaction(async (tx) => {
        const pending = await tx.pending_message.findMany({
          where: { session_key },
          orderBy: { id: 'asc' },
        });

        if (pending.length === 0) {
          return [];
        }

        await tx.pending_message.deleteMany({
          where: { session_key },
        });

        return pending.map((item) => item.content);
      });
    });
  }

  public async list_sessions_with_pending(): Promise<pending_session_info[]> {
    const sessions = await prisma.conversation_session.findMany({
      where: {
        handoff_active: false,
        pending_messages: {
          some: {},
        },
      },
      include: {
        _count: {
          select: { pending_messages: true },
        },
      },
    });

    return sessions.map((session) => ({
      account_id: session.account_id,
      conversation_id: session.conversation_id,
      sender_identifier: session.sender_identifier || `chatwoot_${session.conversation_id}`,
      pending_count: session._count.pending_messages,
    }));
  }

  public async clear_all(): Promise<void> {
    await prisma.pending_message.deleteMany();
    await prisma.conversation_session.deleteMany();
  }
}

interface memory_session_record {
  account_id: number | string;
  conversation_id: number | string;
  sender_identifier?: string;
  handoff_active: boolean;
  handoff_reason?: string;
  handed_off_at?: number;
}

export class memory_session_store implements session_store {
  private sessions: Map<string, memory_session_record>;
  private pending: Map<string, string[]>;

  constructor() {
    this.sessions = new Map<string, memory_session_record>();
    this.pending = new Map<string, string[]>();
  }

  private get_session_key(account_id: number | string, conversation_id: number | string): string {
    return `${account_id}_${conversation_id}`;
  }

  public async activate_handoff(
    account_id: number | string,
    conversation_id: number | string,
    reason?: string
  ): Promise<void> {
    const session_key = this.get_session_key(account_id, conversation_id);
    const existing = this.sessions.get(session_key);
    this.sessions.set(session_key, {
      account_id,
      conversation_id,
      sender_identifier: existing?.sender_identifier,
      handoff_active: true,
      handoff_reason: reason,
      handed_off_at: Date.now(),
    });
  }

  public async release_handoff(
    account_id: number | string,
    conversation_id: number | string
  ): Promise<void> {
    const session_key = this.get_session_key(account_id, conversation_id);
    const existing = this.sessions.get(session_key);
    if (existing) {
      existing.handoff_active = false;
      existing.handoff_reason = undefined;
      existing.handed_off_at = undefined;
    }
  }

  public async load_active_handoffs(): Promise<session_handoff_info[]> {
    const result: session_handoff_info[] = [];
    for (const record of this.sessions.values()) {
      if (record.handoff_active) {
        result.push({
          account_id: record.account_id,
          conversation_id: record.conversation_id,
          handed_off_at: record.handed_off_at || Date.now(),
          reason: record.handoff_reason,
        });
      }
    }
    return result;
  }

  public async append_pending_message(
    account_id: number | string,
    conversation_id: number | string,
    sender_identifier: string,
    content: string,
    max_cap?: number
  ): Promise<number> {
    const session_key = this.get_session_key(account_id, conversation_id);
    const existing = this.sessions.get(session_key);
    if (!existing) {
      this.sessions.set(session_key, {
        account_id,
        conversation_id,
        sender_identifier,
        handoff_active: false,
      });
    } else {
      existing.sender_identifier = sender_identifier;
    }

    const messages = this.pending.get(session_key) || [];
    if (max_cap !== undefined && messages.length >= max_cap) {
      return messages.length;
    }

    messages.push(content);
    this.pending.set(session_key, messages);
    return messages.length;
  }

  public async consume_pending_messages(
    account_id: number | string,
    conversation_id: number | string
  ): Promise<string[]> {
    const session_key = this.get_session_key(account_id, conversation_id);
    const messages = this.pending.get(session_key) || [];
    this.pending.delete(session_key);
    return [...messages];
  }

  public async list_sessions_with_pending(): Promise<pending_session_info[]> {
    const result: pending_session_info[] = [];
    for (const [key, messages] of this.pending.entries()) {
      if (messages.length > 0) {
        const session = this.sessions.get(key);
        if (session && !session.handoff_active) {
          result.push({
            account_id: session.account_id,
            conversation_id: session.conversation_id,
            sender_identifier: session.sender_identifier || `chatwoot_${session.conversation_id}`,
            pending_count: messages.length,
          });
        }
      }
    }
    return result;
  }

  public async clear_all(): Promise<void> {
    this.sessions.clear();
    this.pending.clear();
  }
}
