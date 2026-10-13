// Zoo Grades. GradeRequirements.csv lists, per player level, the value a zoo should have in each
// category; a grade compares the zoo with its level's targets on a 0-10 scale. Rangers are
// graded on coverage of habitats (the original's numberOfZooKeepersForPerfectGrade).
import { gradeRows, items } from './data';
import type { Game } from './game';

export type GradeName = 'Animal' | 'Ranger' | 'Restaurant' | 'Facilities' | 'Shopping' | 'Overall';

export interface GradeReport {
  grades: Record<GradeName, number>;
  values: Record<string, number>;
  targets: Record<string, number>;
  rangersNeeded: number;
}

const LETTERS = ['F', 'F', 'F', 'D', 'D+', 'C', 'C+', 'B', 'B+', 'A', 'A+'];
export const letter = (n: number) => LETTERS[Math.max(0, Math.min(10, Math.round(n)))];

/** Habitats one ranger can look after. */
const HABITATS_PER_RANGER = 4;

function score(value: number, target: number): number {
  if (target <= 1) return 10;
  return Math.max(0, Math.min(10, Math.floor((value / target) * 10)));
}

export function gradeReport(game: Game): GradeReport {
  const v = { animals: 0, food: 0, facilities: 0, shops: 0, trashCans: 0 };
  let habitats = 0, rangers = 0;
  for (const o of game.s.objects) {
    const t = items.get(o.type)!;
    if (t.category === 'animal') {
      v.animals += t.value * (o.count ?? 1);
      habitats++;
    } else if (t.category === 'staff') rangers++;
    else if (t.rowType === 'FoodVendor') v.food += t.value;
    else if (t.rowType === 'Facility') v.facilities += t.value;
    else if (t.rowType === 'SupportStructure') v.shops += t.value;
    else if (/Trash Can|Recycle Bin/.test(t.name)) v.trashCans += t.value;
  }
  const row = gradeRows.find((r) => r.level === Math.min(game.level, gradeRows.length - 1)) ?? gradeRows[0];
  const rangersNeeded = Math.ceil(habitats / HABITATS_PER_RANGER);
  const grades = {
    Animal: score(v.animals, row?.animals ?? 0),
    Ranger: rangersNeeded === 0 ? 10 : Math.min(10, Math.floor((rangers / rangersNeeded) * 10)),
    Restaurant: score(v.food, row?.food ?? 0),
    Facilities: score(v.facilities, row?.facilities ?? 0),
    Shopping: score(v.shops, row?.shops ?? 0),
    Overall: 0,
  };
  grades.Overall = Math.round((grades.Animal + grades.Ranger + grades.Restaurant + grades.Facilities + grades.Shopping) / 5);
  return {
    grades,
    values: v,
    targets: { animals: row?.animals ?? 0, food: row?.food ?? 0, facilities: row?.facilities ?? 0, shops: row?.shops ?? 0 },
    rangersNeeded,
  };
}
