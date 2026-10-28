import type { KillCamMessage } from '@heist/shared';
import type { PerspectiveCamera } from 'three';
import type { I18n } from '../i18n/I18n';
import { h } from '../ui/dom';

const EYE = 1.6;
const CHEST = 1.2;

/**
 * The kill-cam (Phase 35.1): for a few seconds after another player puts you down, the camera moves
 * to where they stood and looks back at you, and a line says who it was and how long their last
 * answer to a question took. The server sends the facts; this places the camera.
 */
export class KillCamView {
  readonly root = h('div', {
    class: 'killcam',
    attrs: { 'data-role': 'killcam', role: 'status', hidden: '' },
  });
  private shot: { message: KillCamMessage; until: number } | undefined;

  constructor(private readonly i18n: I18n) {}

  start(message: KillCamMessage, now: number): void {
    this.shot = { message, until: now + message.seconds * 1000 };
    const { killer, lastAnswer } = message;
    this.root.textContent = lastAnswer
      ? this.i18n.t('killcam.withAnswer', { name: killer.name, seconds: lastAnswer.seconds })
      : this.i18n.t('killcam.plain', { name: killer.name });
    this.root.hidden = false;
  }

  /** The player who is being watched from, while the shot lasts. */
  get killerId(): number | undefined {
    return this.shot?.message.killer.id;
  }

  active(now: number): boolean {
    return this.shot !== undefined && now < this.shot.until;
  }

  /** Puts the camera at the killer's eyes, looking at the player they put down. */
  place(
    camera: PerspectiveCamera,
    killer: { x: number; y: number; z: number },
    victim: { x: number; y: number; z: number },
  ): void {
    camera.position.set(killer.x, killer.y + EYE, killer.z);
    camera.lookAt(victim.x, victim.y + CHEST, victim.z);
  }

  /** Call every frame: the caption goes when the shot is over or you are up again. */
  frame(now: number, alive: boolean): void {
    if (this.shot && (alive || now >= this.shot.until)) {
      this.shot = undefined;
      this.root.hidden = true;
    }
  }
}
