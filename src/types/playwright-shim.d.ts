declare module "@playwright/test" {
  export interface TestInfo {
    tags: string[];
    annotations: Array<{ type: string; description?: string }>;
  }
}

declare module "@playwright/test/reporter" {
  export interface FullResult {
    status: string;
  }

  export interface TestCase {
    title: string;
    tags: string[];
    annotations: Array<{ type: string; description?: string }>;
    location: { file: string };
    titlePath(): string[];
  }

  export interface TestResult {
    status: string;
    duration: number;
    retry: number;
    annotations?: Array<{ type: string; description?: string }>;
  }

  export interface Reporter {
    onTestEnd?(test: TestCase, result: TestResult): void | Promise<void>;
    onEnd?(result: FullResult): void | Promise<void>;
    printsToStdio?(): boolean;
  }
}
