import { execSync } from 'node:child_process';
import { IProject } from '../project';
import { IProjectAttributeOperation } from '../project-attribute';

export class SolutionAddCsproj implements IProjectAttributeOperation {
  readonly name = 'sln.add.csproj';

  private _slnPath: string;
  private _csprojPath: string;

  constructor(solutionPath: string, csprojPath: string) {
    this._slnPath = solutionPath;
    this._csprojPath = csprojPath;
  }

  up(_: IProject) {
  try {
    execSync(`dotnet sln "${this._slnPath}" add "${this._csprojPath}"`, { stdio: 'inherit' });
    console.log(`${this._csprojPath} project added to ${this._slnPath} solution.`);
  } catch (err) {
    console.error('Failed to add project:', err.message);
  }
    process.stdout.write('✔️\n');
  }

  down(_: IProject) {}
}
