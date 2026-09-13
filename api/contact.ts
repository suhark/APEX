import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';

const SUPPORT_EMAIL = 'support@apextradinglab.app';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, email, subject, message } = req.body ?? {};
  if (!name?.trim() || !email?.trim() || !message?.trim()) {
    return res.status(400).json({ error: 'Name, email, and message are required.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please provide a valid email address.' });
  }
  if (String(message).length > 10000) {
    return res.status(400).json({ error: 'Message is too long.' });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return res.status(500).json({ error: 'Email service is not configured.' });

  const resend = new Resend(resendKey);
  const result = await resend.emails.send({
    from: 'APEX Trading Lab <noreply@apextradinglab.app>',
    to: SUPPORT_EMAIL,
    replyTo: email,
    subject: `[APEX Contact] ${String(subject || 'New message').slice(0, 150)}`,
    text: `Name: ${name}\nEmail: ${email}\n\n${message}`,
  });

  if (result.error) return res.status(500).json({ error: 'Unable to send your message right now.' });
  return res.status(200).json({ ok: true });
}
