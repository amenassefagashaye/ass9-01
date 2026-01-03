// Authentication utilities
export class AuthUtils {
  static validatePassword(password: string): boolean {
    // Add password complexity requirements
    return password.length >= 8 && 
           /[A-Z]/.test(password) &&
           /[a-z]/.test(password) &&
           /\d/.test(password);
  }
  
  static generateSessionToken(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }
  
  static hashPassword(password: string): Promise<string> {
    // In production, use bcrypt or similar
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    return crypto.subtle.digest('SHA-256', data)
      .then(hash => {
        const hashArray = Array.from(new Uint8Array(hash));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      });
  }
}