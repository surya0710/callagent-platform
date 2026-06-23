declare module 'nodemailer' {
  export function createTransport(options: {
    host: string;
    port: number;
    secure: boolean;
    auth?: { user: string; pass: string };
  }): {
    sendMail(message: {
      from: string;
      to: string[];
      cc?: string[];
      bcc?: string[];
      subject: string;
      text: string;
      attachments?: Array<{
        filename: string;
        content: string;
        contentType?: string;
      }>;
    }): Promise<unknown>;
  };
}
