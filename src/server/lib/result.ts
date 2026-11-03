/** A status the REST adapter answers with and the form adapter turns into an error message. */
export type FailureStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429;

export type Failure<S extends FailureStatus = FailureStatus> = { ok: false; status: S; message: string };

/** What a service answers: the data, or why it refused. A service never knows HTTP, only the reason. */
export type Result<T, S extends FailureStatus = FailureStatus> = { ok: true; data: T } | Failure<S>;

export const succeed = <T>(data: T): { ok: true; data: T } => ({ ok: true, data });

export const fail = <S extends FailureStatus>(status: S, message: string): Failure<S> => ({
  ok: false,
  status,
  message,
});
