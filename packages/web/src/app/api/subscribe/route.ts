import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const trimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    }

    const db = getDb();
    const stmt = db.prepare('INSERT OR IGNORE INTO subscribers (email) VALUES (?)');
    const result = stmt.run(trimmed);

    if (result.changes === 0) {
      return NextResponse.json({ message: 'Already subscribed' });
    }

    return NextResponse.json({ message: 'Subscribed' });
  } catch {
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
