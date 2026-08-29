import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';


export interface Entity {
    id: number;
    name: string;
    description: string;
}

@Injectable({
    providedIn: 'root'
})
export class EntityManager {
    addItem(arg0: { name: string; description: string; }) {
        this.addEntity({
            name: "nammmmeeee",
            description: "gfrsgrsdfrsgf",
        })
    }
    deleteItem(id: number) {
        throw new Error('Method not implemented.');
    }

    // Initial mock data simulating a database table
    private initialEntitys: Entity[] = [
        { id: 1, name: 'Angular Framework', description: 'Modern web development platform' },
        { id: 2, name: 'TypeScript', description: 'Typed JavaScript at any scale' },
        { id: 3, name: 'RxJS', description: 'Reactive programming library' }
    ];

    // BehaviorSubject holds the current state and emits it to new subscribers
    private itemsSubject = new BehaviorSubject<Entity[]>(this.initialEntitys);

    // Expose the items as a read-only Observable stream
    public items$: Observable<Entity[]> = this.itemsSubject.asObservable();

    constructor() { }

    // Helper to get the current snapshot of items
    private get currentEntitys(): Entity[] {
        return this.itemsSubject.getValue();
    }

    // --- CREATE ---
    addEntity(newEntityData: Omit<Entity, 'id'>): void {
        const current = this.currentEntitys;
        // Generate a simple pseudo-unique ID based on the highest existing ID + 1
        const newId = current.length > 0 ? Math.max(...current.map(i => i.id)) + 1 : 1;

        const newEntity: Entity = { id: newId, ...newEntityData };

        // Update the subject with the new array, notifying all subscribed components
        this.itemsSubject.next([...current, newEntity]);
    }

    // --- READ ---
    getEntityById(id: number): Entity | undefined {
        return this.currentEntitys.find(item => item.id === id);
    }

    // --- UPDATE ---
    updateEntity(updatedEntity: Entity): void {
        const current = this.currentEntitys;
        const index = current.findIndex(i => i.id === updatedEntity.id);

        if (index !== -1) {
            const updatedList = [...current];
            updatedList[index] = updatedEntity;
            this.itemsSubject.next(updatedList);
        }
    }

    // --- DELETE ---
    deleteEntity(id: number): void {
        const current = this.currentEntitys;
        const filteredList = current.filter(item => item.id !== id);
        this.itemsSubject.next(filteredList);
    }
}