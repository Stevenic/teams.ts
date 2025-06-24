export type Success<T> = {
    success: true;
    data: T;
};

export type Failure<E = string> = {
    success: false;
    error: E;
};

export type Result<T, E = string> = Success<T> | Failure<E>;