import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';

const SUPPORT_EMAIL = 'support@apextradinglab.app';

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[character] ?? character));
}

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
      html: `
        <div style="font-family:Arial,sans-serif;background:#08100f;color:#e8f5f2;padding:32px;max-width:620px;margin:0 auto;border:1px solid #1e4d44;border-radius:14px">
          <div style="border-bottom:1px solid #24443d;padding-bottom:20px;margin-bottom:24px">
            <img src="https://apextradinglab.app/apex-logo.png" alt="APEX Trading Lab" style="max-width:220px;height:auto" />
          </div>
          <p style="color:#50dbc4;font-size:12px;letter-spacing:2px;text-transform:uppercase">New contact message</p>
          <h2 style="color:#f4f7f7;margin:8px 0 24px">${escapeHtml(String(subject || 'APEX support request'))}</h2>
          <p><strong>From:</strong> ${escapeHtml(String(name))} &lt;${escapeHtml(String(email))}&gt;</p>
          <div style="background:#0d1a17;border-left:3px solid #42d5bb;padding:16px;margin-top:22px;white-space:pre-wrap;line-height:1.6">${escapeHtml(String(message))}</div>
          <p style="color:#718b85;font-size:12px;margin-top:28px">Reply to this email to respond directly to the sender.</p>
        </div>
      `,
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
