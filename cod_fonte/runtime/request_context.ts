import { AsyncLocalStorage } from 'node:async_hooks';

export interface conversation_context {
  account_id?: number | string;
  conversation_id?: number | string;
}

const conversation_context_storage = new AsyncLocalStorage<conversation_context>();

export function run_with_conversation_context<result_type>(
  context: conversation_context,
  executor: () => Promise<result_type>
): Promise<result_type> {
  return conversation_context_storage.run({ ...context }, executor);
}

export function get_conversation_context(): conversation_context | undefined {
  return conversation_context_storage.getStore();
}
