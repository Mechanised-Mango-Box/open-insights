import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable } from 'rxjs';
import { EntityManager } from './entity-manager'
import { Entity } from './entity-manager';

@Component({
  selector: 'test-add',
  standalone: true,
  imports: [CommonModule],
  template: `
    <h2>Item Database Service Example</h2>
    
    <!-- Add Item Button -->
    <button (click)="addNewItem()">Add New Item</button>

    <ul>
      <!-- Using the async pipe automatically subscribes and unsubscribes -->
      <li *ngFor="let item of items$ | async">
        <strong>{{ item.name }}</strong>: {{ item.description }}
        <button (click)="removeItem(item.id)">Delete</button>
      </li>
    </ul>
  `
})
export class EntityListComponent implements OnInit {
  private itemService = inject(EntityManager);
  
  // Expose the observable directly to the template
  items$!: Observable<Entity[]>;

  ngOnInit() {
    this.items$ = this.itemService.items$;
  }

  addNewItem() {
    this.itemService.addItem({
      name: 'New Item ' + Math.floor(Math.random() * 100),
      description: 'Created dynamically via service'
    });
  }

  removeItem(id: number) {
    this.itemService.deleteItem(id);
  }
}