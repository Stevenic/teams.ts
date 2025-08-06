import assert from 'assert';

export const assertNever = (value: never, message?: string): never => {
    assert(false, message ?? `Unexpected value: ${value}`);
};