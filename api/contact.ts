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
  if (!resendKey) {
    console.error('[contact] RESEND_API_KEY is missing');
    return res.status(500).json({ error: 'Email service is not configured. Add RESEND_API_KEY in Vercel and redeploy.' });
  }

  try {
    const resend = new Resend(resendKey);
    const result = await resend.emails.send({
      from: 'APEX Trading Lab <noreply@apextradinglab.app>',
      to: SUPPORT_EMAIL,
      replyTo: email,
      subject: `[APEX Contact] ${String(subject || 'New message').slice(0, 150)}`,
      text: `Name: ${name}\nEmail: ${email}\n\n${message}`,
    });

    if (result.error) {
      console.error('[contact] Resend rejected email:', result.error);
      return res.status(502).json({ error: result.error.message || 'Resend rejected the email. Check your verified sending domain and RESEND_API_KEY.' });
    }
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[contact] Unexpected email error:', error);
    return res.status(500).json({ error: 'The email service failed unexpectedly. Please try again or email support@apextradinglab.app directly.' });
  }
}
