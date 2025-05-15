import * as changeCase from 'change-case';
import Handlebars from 'handlebars';

import { IProject } from './project';


export class HandlebarsTemplate {
    static _runtimeOptions: Handlebars.RuntimeOptions = {
        helpers: {
            capitalize: (text: string) => {
            if (!text) return '';
            return changeCase.capitalCase(text);
            },
            toPascalCase: (text: string) => {
            if (!text) return '';
            return changeCase.pascalCase(text);
            },
            toDotCase: (text: string) => {
            if (!text) return '';
            return changeCase.dotCase(text);
            },
            toKebabCase: (text: string) => {
            if (!text) return '';
            return changeCase.kebabCase(text);
            },
        },
    };

    static render(input: any, options?: CompileOptions, project?: IProject) {
        const template = Handlebars.compile(input, options);
        return template(project, this._runtimeOptions);
    }
}