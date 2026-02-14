export type VulnerabilityType = 'command_injection' | 'path_traversal' | 'symlink_attack' | 'information_disclosure';
export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface SecurityEvent {
  timestamp: string;
  eventType: 'blocked_command' | 'path_violation' | 'validation_failure';
  severity: Severity;
  details: {
    tool?: string;
    command?: string;
    path?: string;
    reason: string;
  };
  sessionId: string;
}

export interface SecurityAudit {
  toolName: string;
  vulnerabilities: Vulnerability[];
  mitigations: Mitigation[];
  status: 'pending' | 'reviewed' | 'hardened';
}

export interface Vulnerability {
  type: VulnerabilityType;
  severity: Severity;
  description: string;
  location: string;
  cwe?: string;
}

export interface Mitigation {
  vulnerability: string;
  fix: string;
  implemented: boolean;
}
