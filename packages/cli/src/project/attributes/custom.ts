import { Compound } from '../operations';
import { IProjectAttribute, IProjectAttributeOperation } from '../project-attribute';

export class CustomAttribute implements IProjectAttribute {
  readonly id = 'env';
  readonly name = 'environment';
  readonly alias = 'env';
  readonly description = 'add environment variables';

  private readonly _operations: IProjectAttributeOperation[];

  constructor(...ops: IProjectAttributeOperation[]) {
    this._operations = ops;
  }

  typescript(_: string) {
    return new Compound(...this._operations);
  }

  async csharp(_: string) {
    return new Compound(...this._operations);
  }
}
