/**
 * IPC error helper - all IPC handlers should return errors in a structured way.
 *
 * Renderer expects either:
 *   - success: { ok: true, data: ... }
 *   - error:   { ok: false, error: { code, message } }
 */

export interface IpcSuccess<T = any> {
  ok: true;
  data: T;
}

export interface IpcError {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: any;
  };
}

export type IpcResult<T = any> = IpcSuccess<T> | IpcError;

export function ok<T>(data: T): IpcSuccess<T> {
  return { ok: true, data };
}

export function err(code: string, message: string, details?: any): IpcError {
  return { ok: false, error: { code, message, details } };
}

/**
 * Wrap an async IPC handler with try/catch and structured error return.
 *
 * Usage:
 *   ipcMain.handle('foo', wrap(async () => { ... return data; }));
 *
 * Note: wrap returns an async function that takes (evt, ...args) and returns
 * Promise<IpcResult<T>>. The handler body throws on error; wrap converts
 * thrown errors into structured IpcError responses.
 *
 * The handler body can access the original (evt, args) via the second parameter:
 *   ipcMain.handle('foo', wrap(async (_evt, args) => { ... }));
 */
export function wrap<T>(
  fn: (evt?: any, args?: any) => Promise<T> | T
): (evt?: any, args?: any) => Promise<IpcResult<T>> {
  return async (evt?: any, args?: any): Promise<IpcResult<T>> => {
    try {
      const data = await fn(evt, args);
      return ok(data);
    } catch (e: any) {
      const message = e?.message || String(e);
      // Map common SQLite errors to user-friendly messages
      let code = 'INTERNAL';
      let friendly = message;

      if (message.includes('UNIQUE constraint failed')) {
        code = 'DUPLICATE';
        friendly = 'A record with this value already exists.';
      } else if (message.includes('FOREIGN KEY constraint failed')) {
        code = 'FOREIGN_KEY';
        friendly = 'This action depends on other records that may not exist or cannot be deleted.';
      } else if (message.includes('CHECK constraint failed')) {
        code = 'INVALID_VALUE';
        friendly = 'One of the entered values is invalid.';
      } else if (message.includes('no such table')) {
        code = 'DB_ERROR';
        friendly = 'Database schema is out of date. Please contact support.';
      }

      return err(code, friendly, process.env.NODE_ENV === 'development' ? message : undefined);
    }
  };
}
