// sql.js 类型声明
declare module "sql.js" {
  export interface SqlJsConfig {
    locateFile?: (file: string) => string;
  }

  export interface QueryResult {
    columns: string[];
    values: any[][];
  }

  export interface Statement {
    bind(values?: any[]): boolean;
    step(): boolean;
    get(): any[];
    getAsObject(): any;
    getColumnNames(): string[];
    free(): void;
    run(values?: any[]): void;
  }

  export class Database {
    constructor(data?: Uint8Array);
    run(sql: string, params?: any[]): void;
    exec(sql: string, params?: any[]): QueryResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }

  export interface SQL {
    Database: typeof Database;
  }

  export default function initSqlJs(config?: SqlJsConfig): Promise<SQL>;
}
