import * as changeCase from 'change-case';
import Handlebars from 'handlebars';

import { IProject } from './project';


export class HandlebarsTemplate {
    private static _runtimeOptions: Handlebars.RuntimeOptions = {
        helpers: {
            capitalize: (text: string) => !text ? '' : changeCase.capitalCase(text),
            toPascalCase: (text: string) => !text ? '' : changeCase.pascalCase(text),
            toDotCase: (text: string) => !text ? '' : changeCase.dotCase(text),
            toKebabCase: (text: string) => !text ? '' : changeCase.kebabCase(text),
        },
    };

    static render(input: any, options?: CompileOptions, project?: IProject) {
        const template = Handlebars.compile(input, options);
        return template(project, this._runtimeOptions);
    }
}