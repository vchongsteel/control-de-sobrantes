import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DespachosPage } from './despachos.page';

describe('DespachosPage', () => {
  let component: DespachosPage;
  let fixture: ComponentFixture<DespachosPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(DespachosPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
