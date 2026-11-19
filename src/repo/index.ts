import { ApiRepository } from './ApiRepository';
import type { GameRepository } from './GameRepository';

export const repository: GameRepository = new ApiRepository();
export type { GameRepository, SaveSummary } from './GameRepository';
