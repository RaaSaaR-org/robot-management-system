/**
 * @file ViewerGuard.tsx
 * @description WebGL capability check + error boundary around a 3D canvas. A
 *              browser without WebGL (or a context that fails to start) renders
 *              the calm ViewerUnavailable panel instead of crashing the page.
 * @feature robots
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ViewerUnavailable } from '../common';

let webglSupport: boolean | null = null;

/** Whether this browser can create a WebGL context (cached after the first probe). */
export function hasWebGL(): boolean {
  if (webglSupport !== null) return webglSupport;
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    webglSupport = !!ctx;
    // Release the probe context right away; browsers cap live contexts.
    (ctx as WebGLRenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webglSupport = false;
  }
  return webglSupport;
}

interface ViewerGuardProps {
  children: ReactNode;
  /** Title of the unavailable panel */
  title?: string;
  /** Description of the unavailable panel */
  description?: string;
  className?: string;
}

interface ViewerGuardState {
  failed: boolean;
}

/**
 * Renders its children only when WebGL is available, and catches any render
 * error thrown by the canvas subtree (e.g. "Error creating WebGL context").
 */
export class ViewerGuard extends Component<ViewerGuardProps, ViewerGuardState> {
  state: ViewerGuardState = { failed: false };

  static getDerivedStateFromError(): ViewerGuardState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn('3D viewer unavailable:', error.message, info.componentStack?.split('\n')[1]?.trim());
  }

  render() {
    const { children, title, description, className } = this.props;
    if (this.state.failed || !hasWebGL()) {
      return <ViewerUnavailable title={title} description={description} className={className} />;
    }
    return children;
  }
}
