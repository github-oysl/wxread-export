// aws4fetch 类型声明（简单版本）
declare module "aws4fetch" {
  export class AwsV4Signer {
    constructor(options: {
      url: string;
      method?: string;
      headers?: HeadersInit;
      body?: any;
      accessKeyId: string;
      secretAccessKey: string;
      service?: string;
      region?: string;
    });
    sign(): Promise<{
      url: string;
      method: string;
      headers: Headers;
      body?: any;
    }>;
  }
}
